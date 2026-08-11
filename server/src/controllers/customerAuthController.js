// Phase 1.1 — customer phone + OTP login.
//
// SMS delivery goes through `src/lib/sms.js` (MSG91), which is real once the
// client's credentials are in the environment and a logging stub until then —
// the same seam `razorpay.js` uses, and no caller here changes either way.
// Outside production the code is echoed in the response so the flow is fully
// testable without a provider. Everything else has always been real: the code is
// bcrypt-hashed, expires, counts attempts, and is consumed once.
//
// ⚠️ **The OTP machinery moved to `src/lib/otp.js` on 2026-08-11**, when rider
// self-registration became the second flow that issues codes for a phone number.
// Nothing about this endpoint's behaviour changed — the code is still hashed,
// still expires, still counts five attempts, still burns un-consumed, and
// production still never sees it. What moved is the *implementation*, for the
// same reason `normalizePhone` moved out of this file: a second copy is how one
// of the two quietly stops expiring.
//
// The one thing the shared library adds is `purpose`. Codes issued here are
// `CUSTOMER_LOGIN` and are invisible to the rider flow, so a customer refreshing
// a session no longer kills a code a rider is half way through typing on the
// same phone.
import prisma from '../lib/prisma.js';
import { signCustomerToken } from '../lib/customerToken.js';
// Moved to `src/lib/phone.js` when staff sign-in started accepting phone
// numbers too — one normaliser for both sides, so one human is one row on
// either. Behaviour here is unchanged.
import { normalizePhone } from '../lib/phone.js';
import { issue, verify, OTP_PURPOSE, OTP_TTL_SECONDS } from '../lib/otp.js';

// `createdAt` is here so the Profile screen can say "Member since March 2026"
// (2026-08-10). It is a real, already-stored fact rather than a computed one —
// the alternative was a profile header with nothing under the phone number, and
// inventing a figure to fill it is exactly what this codebase does not do.
// Additive: no caller reads a fixed key set, and a test pins the shape.
const publicCustomer = (c) => ({
  id: c.id,
  phone: c.phone,
  name: c.name,
  email: c.email,
  createdAt: c.createdAt
});

export const requestOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ message: 'Please provide a valid 10-digit mobile number.' });
    }

    const result = await issue(phone, OTP_PURPOSE.CUSTOMER_LOGIN);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message, reason: result.reason });
    }

    return res.status(200).json({
      status: 'success',
      message: 'OTP sent.',
      expiresInSeconds: OTP_TTL_SECONDS,
      // ⚠️ Production never sees this — a test pins it. It is what makes the
      // flow testable while SMS is stubbed.
      ...(result.code ? { code: result.code } : {})
    });
  } catch (error) {
    console.error('OTP Request Error:', error);
    return res.status(500).json({ message: 'Server error while sending the OTP.' });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : null;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Please provide a valid mobile number and OTP.' });
    }

    // One message for every failure mode — a caller must not learn whether the
    // phone has a pending code, only that this attempt failed. `lib/otp.js`
    // holds that rule, along with expiry, the attempt count and the single
    // consume.
    //
    // The blocked check runs as the library's `guard`: after the code matches,
    // before it is consumed. Checking earlier would tell a stranger who typed
    // the number that it is blocked; checking later would burn a code for
    // somebody whose block is lifted a minute afterwards.
    let existing = null;
    const check = await verify(phone, code, OTP_PURPOSE.CUSTOMER_LOGIN, {
      guard: async () => {
        existing = await prisma.customer.findUnique({ where: { phone } });
        return existing?.isBlocked
          ? { status: 403, message: 'This account has been blocked.' }
          : null;
      }
    });

    if (!check.ok) {
      return res.status(check.status).json({ message: check.message });
    }

    const customer = existing ?? (await prisma.customer.create({ data: { phone } }));

    return res.status(200).json({
      status: 'success',
      token: signCustomerToken(customer.id),
      isNewCustomer: !existing,
      customer: publicCustomer(customer)
    });
  } catch (error) {
    console.error('OTP Verify Error:', error);
    return res.status(500).json({ message: 'Server error while verifying the OTP.' });
  }
};

export const getCustomerMe = async (req, res) => {
  return res.status(200).json({ status: 'success', customer: publicCustomer(req.customer) });
};
