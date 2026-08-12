// One phone-OTP implementation, for every flow that uses one.
//
// This is `customerAuthController`'s machinery, extracted unchanged when rider
// self-registration became the second caller (2026-08-11). It is the same
// reasoning as `lib/phone.js`: two normalisers is how one human becomes two
// rows, and **two OTP implementations is how one of them quietly stops
// expiring, stops counting attempts, or starts leaking its code in
// production.** Every property below is load-bearing and none of it is worth
// re-deriving per flow:
//
//   • the code is bcrypt-hashed, never stored in plaintext
//   • it expires (`OTP_TTL_SECONDS`, 5 minutes)
//   • five wrong guesses burn it, and the burned token is left un-consumed so
//     the *correct* code cannot be tried afterwards either
//   • it is consumed exactly once
//   • requests are rate-limited per phone per window
//   • production never sees the code in a response body
//
// WHAT IS NEW HERE is `purpose`. One human is plausibly both a customer and a
// delivery partner on the same number, and `issue()` supersedes live codes so a
// superseded one cannot verify. Shared blindly between two flows that would be
// cross-talk — a rider mid-registration losing his code because the Customer app
// refreshed a session in the background. So both the supersede and the lookup
// are scoped to a purpose.
//
// ⚠️ `purpose` is NOT a privilege boundary. Any code proves possession of the
// same phone number, and no flow grants anything that number does not already
// own. It exists so two queues do not cancel each other, and reading more into
// it than that would be a mistake.
//
// The rate limit is scoped the same way, so a number gets its five requests per
// window **in each flow** rather than five across both. That is deliberate: a
// rider registering must not be locked out by his own Customer app, which is the
// same collision `purpose` exists to prevent. With two flows it caps a single
// number at ten messages per ten minutes, which is the cost of not having the
// two interfere.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from './prisma.js';
import { sendOtpSms, isLive as smsIsLive } from './sms.js';

const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 300); // 5 minutes
const OTP_MAX_ATTEMPTS = 5; // wrong guesses before the token is burned
const OTP_REQUEST_WINDOW_SECONDS = 600;
const OTP_MAX_REQUESTS_PER_WINDOW = 5; // per phone, per purpose, per window

/** The flows that issue codes. A string column, so this is documentation with teeth. */
export const OTP_PURPOSE = Object.freeze({
  CUSTOMER_LOGIN: 'CUSTOMER_LOGIN',
  RIDER_SIGNUP: 'RIDER_SIGNUP',
  // The business app's second door (2026-08-12). Its own purpose, not a reuse of
  // RIDER_SIGNUP, because `issue` supersedes live codes **per purpose**: a shop
  // owner who also drives — or a phone shared between a shop and its delivery
  // boy — must not have one flow's code cancel the other's. The rate limit is
  // per phone *per purpose* for the same reason.
  STAFF_LOGIN: 'STAFF_LOGIN'
});

const generateCode = () => {
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');
};

// Only test/development ever see the code. Production must not leak it.
//
// The one exception is deliberate and temporary (2026-08-11): the client's DLT
// portal subscription has lapsed, so MSG91 cannot send until they renew it at
// launch. Until then a hosted, NODE_ENV=production build would have no SMS *and*
// no code in the response — nobody could log in, and every other feature would be
// untestable behind a sign-in screen. `OTP_ECHO_CODE=true` reopens the echo.
//
// It is its own flag rather than a relaxed NODE_ENV check on purpose: turning it
// off is one line in the environment at launch, it is greppable, and no other
// production behaviour (cookies, logging, error shape) moves with it. A test pins
// that production *without* the flag still hides the code.
const echoOverride = () => String(process.env.OTP_ECHO_CODE).toLowerCase() === 'true';
export const exposesCode = () => process.env.NODE_ENV !== 'production' || echoOverride();

/**
 * Issue a code for this phone and send it.
 *
 * @param {string} phone the **normalised** 10-digit form. Callers normalise
 *   first (`lib/phone.js`) — an unnormalised number here would issue a code
 *   against a key that `verify` can never match.
 * @param {string} purpose one of `OTP_PURPOSE`
 * @returns one of:
 *   `{ ok: true, code?: string }` — sent. `code` only when `exposesCode()`.
 *   `{ ok: false, status, message, reason }` — ready to hand to `res`.
 */
export async function issue(phone, purpose) {
  const windowStart = new Date(Date.now() - OTP_REQUEST_WINDOW_SECONDS * 1000);
  const recent = await prisma.otpToken.count({
    where: { phone, purpose, createdAt: { gte: windowStart } }
  });
  if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) {
    return {
      ok: false,
      status: 429,
      message: 'Too many OTP requests. Please try again shortly.',
      reason: 'OTP_RATE_LIMITED'
    };
  }

  const code = generateCode();

  // Supersede any live code for this phone *in this flow*, so only the newest
  // one verifies. Scoped by purpose — see the header.
  await prisma.otpToken.updateMany({
    where: { phone, purpose, consumedAt: null },
    data: { consumedAt: new Date() }
  });

  await prisma.otpToken.create({
    data: {
      phone,
      purpose,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000)
    }
  });

  const delivery = await sendOtpSms(phone, code);

  // In production, a code the recipient will never receive is a dead end: the
  // rate limiter would then hold them off for ten minutes over our outage.
  // Say so plainly rather than claiming "OTP sent".
  if (!delivery.sent && smsIsLive() && !exposesCode()) {
    return {
      ok: false,
      status: 502,
      message: 'Could not send the OTP right now. Please try again in a moment.',
      reason: 'SMS_DELIVERY_FAILED'
    };
  }

  // ⚠️ Production never sees `code` — a test pins it. It is what makes the flow
  // testable while SMS is stubbed.
  return { ok: true, ...(exposesCode() ? { code } : {}) };
}

/**
 * Check a code and consume it.
 *
 * Every failure mode answers with the **same** message, deliberately: a caller
 * must not learn whether a phone has a pending code, only that this attempt
 * failed. A different message for "no code outstanding" is a free directory of
 * who is mid-signup.
 *
 * @param {string} phone normalised
 * @param {string} code as typed
 * @param {string} purpose one of `OTP_PURPOSE`
 * @param {object} [options]
 * @param {() => Promise<null|{status:number,message:string,reason?:string}>} [options.guard]
 *   Run **after** the code matches and **before** it is consumed. Return a
 *   failure to abort, and the code is left un-consumed.
 *
 *   That ordering is the whole point of the hook, and it is why the blocked-customer
 *   check cannot simply live in the caller. Before the match, refusing a blocked
 *   phone would tell any stranger who typed that number that it is blocked. After
 *   the consume, a refusal would have burned a code the caller never got to use —
 *   so an account whose block is lifted, or a state that turns out not to apply,
 *   costs an SMS and a wait for nothing.
 * @returns `{ ok: true }`, or `{ ok: false, status, message, reason }`
 */
export async function verify(phone, code, purpose, { guard } = {}) {
  const invalid = {
    ok: false,
    status: 401,
    message: 'Invalid or expired OTP.',
    reason: 'OTP_INVALID'
  };

  const token = await prisma.otpToken.findFirst({
    where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });

  if (!token) return invalid;

  // Locked out. The token is left un-consumed on purpose so this branch keeps
  // answering 429 — and so the *correct* code cannot be tried afterwards
  // either. It stays dead until it expires and a new one is requested.
  if (token.attempts >= OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      status: 429,
      message: 'Too many incorrect attempts. Request a new OTP.',
      reason: 'OTP_BURNED'
    };
  }

  if (!(await bcrypt.compare(code, token.codeHash))) {
    await prisma.otpToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } }
    });
    return invalid;
  }

  if (guard) {
    const refusal = await guard();
    if (refusal) return { ok: false, ...refusal };
  }

  await prisma.otpToken.update({
    where: { id: token.id },
    data: { consumedAt: new Date() }
  });

  return { ok: true };
}
