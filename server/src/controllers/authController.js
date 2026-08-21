import prisma from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { normalizePhone, looksLikePhone } from '../lib/phone.js';
import { issue, verify, OTP_PURPOSE, OTP_TTL_SECONDS } from '../lib/otp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'roadmate_secret_key_2026_secure_hash';

// Generate Token
// Exported since 2026-08-11: `riderAuthController` signs the *same* staff token
// after a rider verifies an OTP. A second signer is how one of the two ends up
// with a different expiry or a stray claim that `protect` then has to tolerate.
export const signToken = (userId, role) => {
  return jwt.sign({ userId, role }, JWT_SECRET, {
    expiresIn: '24h'
  });
};

/**
 * Staff sign in with **either** an email address or a phone number (client
 * confirmed 2026-08-07: "also", not "instead").
 *
 * Three things this has to hold together:
 *
 *   • **The 7 web dashboards keep working.** They post `{ email, password }`,
 *     so `email` is still accepted verbatim; `identifier` is the new field the
 *     apps send. Neither is required to be one or the other.
 *   • **One human is one row.** The phone is matched on its *normalised* form,
 *     the same `normalizePhone` the customer side has always used, and
 *     `User.phone` now carries a unique index — so "+91 98765 00011" cannot
 *     become a second shop owner.
 *   • **Nothing is enumerable.** Every failure below returns the same 401 with
 *     the same wording, whether the identifier was unknown, the password wrong,
 *     or the input not a valid phone number at all. A different message for
 *     "no such number" is a free directory of who is on the platform.
 *
 * Existing sessions are untouched: this changes lookup only, and the token is
 * signed exactly as before.
 */
const INVALID = 'Invalid credentials. Check the email address or phone number and password.';

export const USER_INCLUDE = {
  industry: {
    select: {
      id: true,
      name: true,
      slug: true,
      // Which screens this partner's app should even offer. A turf keeps a
      // calendar and a grocer does not, and the alternative to sending this is
      // every app guessing from the industry's *name* — which is a human-typed
      // string a dashboard can rename at any time.
      fulfilmentType: true
    }
  },
  // A rider's employer, when they have one (HANDOFF §3). The Rider app needs the
  // *name* and not just the id — "You deliver for Kannan Motors" is what makes
  // an app with no earnings tab make sense.
  employerShop: {
    select: { id: true, name: true, businessName: true }
  }
};

/**
 * The signed-in account, as every app and dashboard sees it.
 *
 * `login` and `getMe` return the **same** shape on purpose: `session.js` sets
 * the user from whichever of the two answered first (sign-in, or a cold-start
 * restore), and a field present in one and missing from the other is a screen
 * that works until the app is reopened. Both routes include `USER_INCLUDE`.
 *
 * ⚠️ Since 2026-08-11 there is a **third** door onto this shape: a rider signing
 * in with a phone number and an OTP (`riderAuthController.verifyOtp`). It is
 * exported for that reason and must stay the only projection — the Rider app's
 * session cannot tell which of the three answered, and must not have to.
 */
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    // ⚠️ Load-bearing for the Rider app's door. `EXECUTIVE` is two different
    // people: a DELIVERY executive is a rider and has an app; a LISTING
    // executive onboards shops and has none (HANDOFF §4). Without this the
    // Rider app cannot tell them apart and would sign a field executive in to
    // an empty job list.
    executiveType: user.executiveType,
    country: user.country,
    stateName: user.stateName,
    districtName: user.districtName,
    regionName: user.regionName,
    businessName: user.businessName,
    gstNumber: user.gstNumber,
    safetyStockBuffer: user.safetyStockBuffer,
    industry: user.industry,
    // The shop's own switch between the two delivery modes.
    usesOwnRiders: user.usesOwnRiders,
    // A rider's own shift state, so a cold start renders the toggle as it
    // really is rather than assuming "off" and inviting a tap that turns a
    // working shift off.
    isOnShift: user.isOnShift,
    // What he rides (2026-08-11). Additive, and the first thing a rider who has
    // just registered himself looks for — it is the detail he typed, on the
    // vehicle he is standing next to, and the one field on his profile he could
    // plausibly have got wrong. Null for every account onboarded without one.
    //
    // ⚠️ Safe to add here because `getMe` and `login` both `include` rather than
    // `select`, so every `User` column is already loaded. A projection naming a
    // column the query never fetched fails **silently** — see the note on
    // `publicCustomer` and `protectCustomer`'s select, which is the same trap on
    // the customer side.
    vehicleType: user.vehicleType,
    vehicleNumber: user.vehicleNumber,
    // Null for a RoadMate delivery partner. Set for a shop's own delivery boy.
    // ⚠️ It no longer hides the earnings screen — the platform pays every rider
    // since 2026-08-09 — it decides whose orders he is offered.
    employerShopId: user.employerShopId,
    employerShop: user.employerShop
      ? {
          id: user.employerShop.id,
          name: user.employerShop.businessName || user.employerShop.name
        }
      : null
  };
}

/** Resolve a staff account from an email address or a phone number. */
async function findByIdentifier(identifier) {
  const raw = String(identifier).trim();

  if (looksLikePhone(raw)) {
    const phone = normalizePhone(raw);
    // A malformed number resolves to nobody, and says so with the same 401 as
    // a wrong password — see the note above.
    if (!phone) return null;
    // `findFirst`, not `findUnique`: the unique index makes at most one row
    // possible, but Prisma only offers `findUnique` on a field it knows is
    // unique in the schema, and this stays correct either way.
    return prisma.user.findFirst({ where: { phone }, include: USER_INCLUDE });
  }

  // Exact match first — that is precisely what this endpoint did before, so no
  // existing account can be broken by this change. The lowercase retry is an
  // addition for people who capitalise the first letter on a phone keyboard;
  // every row in the database today is already lowercase.
  const exact = await prisma.user.findUnique({ where: { email: raw }, include: USER_INCLUDE });
  if (exact) return exact;

  const lowered = raw.toLowerCase();
  if (lowered === raw) return null;
  return prisma.user.findUnique({ where: { email: lowered }, include: USER_INCLUDE });
}

export const login = async (req, res) => {
  try {
    // `identifier` is what the apps send; `email` is what the 7 dashboards have
    // always sent and must keep working.
    const identifier = req.body?.identifier ?? req.body?.email ?? req.body?.phone;
    const { password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Please provide an email address or phone number, and a password' });
    }

    const user = await findByIdentifier(identifier);

    if (!user) {
      // Still hash-compare nothing? No — but do not branch the timing further
      // than the existing code did. The message is what matters here.
      return res.status(401).json({ message: INVALID });
    }

    // Check password
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: INVALID });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Your account is pending activation by regional administrators.' });
    }

    // Generate JWT
    const token = signToken(user.id, user.role);

    // Return profile credentials omitting the raw hashed password
    res.status(200).json({
      status: 'success',
      token,
      user: publicUser(user)
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server error during login authentication.' });
  }
};

// ── The second door: phone + OTP (2026-08-12) ───────────────────────────────
//
// A shop owner can now sign in with a code instead of a password. This is an
// **addition**, not a replacement, and the distinction is load-bearing:
//
//   • **The 7 web dashboards have no OTP screen.** Master, State, Industry
//     State, District, Regional, Manufacturer and Distributor all sign in with
//     `POST /api/auth/login` from a browser. Take the password away and those
//     seven surfaces have no door at all. (Shops are not among them — a shop's
//     only surface is the app — which is exactly why the OTP door is safe to
//     offer to shops first and why it cannot be made the *only* door for the
//     roles that do have a dashboard.)
//   • **A till is shared; a phone is not.** The counter phone, the owner's
//     phone and a second staffer are one account. An OTP proves possession of
//     one number, so it is the right door for the owner and the wrong one for
//     whoever happens to be at the counter. Both must exist.
//   • **It is also the password reset this platform never had.** There is no
//     reset endpoint anywhere, and `createPartner` defaults a blank password to
//     `password123` — so "what is my password" had no answer better than asking
//     an admin to overwrite it. A locked-out owner now has a way back in that
//     costs nobody a support call.
//
// ⚠️ **This door needs SMS that works.** `lib/otp.js` echoes the code in the
// response while `OTP_ECHO_CODE=true` covers the lapsed DLT subscription; the
// moment that flag comes off at launch, an unrenewed subscription makes this
// endpoint a dead end. The password door is what keeps that from being an
// outage — do not remove it.

/**
 * POST /api/auth/otp/request
 *
 * Answers identically for a number with an account and a number nobody has ever
 * seen. Staff accounts are *issued* — there is no self-signup here to send an
 * unknown number to — so the only thing a specific answer could do is tell a
 * stranger which numbers belong to RoadMate partners.
 */
export const requestStaffOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ message: 'Please provide a valid 10-digit mobile number.' });
    }

    const result = await issue(phone, OTP_PURPOSE.STAFF_LOGIN);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message, reason: result.reason });
    }

    return res.status(200).json({
      status: 'success',
      message: 'OTP sent.',
      expiresInSeconds: OTP_TTL_SECONDS,
      // ⚠️ Production never sees this — a test pins it. `lib/otp.js` owns the rule.
      ...(result.code ? { code: result.code } : {})
    });
  } catch (error) {
    console.error('Staff OTP Request Error:', error);
    return res.status(500).json({ message: 'Server error while sending the OTP.' });
  }
};

/**
 * POST /api/auth/otp/verify
 *
 * On success this returns **exactly** what `login` returns — same token from the
 * same signer, same `publicUser` projection. `session.js` cannot tell which door
 * was used and must not have to; a second shape here is a second set of bugs in
 * every screen that reads the session.
 *
 * Unlike the request step, this can afford to be specific: the caller has just
 * proved they hold the number.
 */
export const verifyStaffOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : null;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Please provide a valid mobile number and OTP.' });
    }

    const check = await verify(phone, code, OTP_PURPOSE.STAFF_LOGIN);
    if (!check.ok) {
      return res.status(check.status).json({ message: check.message, reason: check.reason });
    }

    // `findFirst` rather than `findUnique` — the same note as `findByIdentifier`.
    const user = await prisma.user.findFirst({ where: { phone }, include: USER_INCLUDE });

    if (!user) {
      return res.status(404).json({
        message:
          'This number does not have a RoadMate business account. Ask your regional partner to add it.',
        reason: 'NO_ACCOUNT'
      });
    }

    // A delivery executive is a rider, and riders have their own app with its own
    // door. Signing one in here would drop him into a shop's tabs. Sending the
    // role rather than a sentence keeps the role→app mapping in the app, where
    // `APP_FOR_ROLE` already lives.
    if (user.role === 'EXECUTIVE' && user.executiveType === 'DELIVERY') {
      return res.status(403).json({
        message: 'This number belongs to a delivery partner. Please use the RoadMate Rider app.',
        reason: 'WRONG_APP',
        role: user.role,
        executiveType: user.executiveType
      });
    }

    // Deliberately the same check, wording and status as the password door. Two
    // doors that disagree about who may come in is the bug this mirrors away.
    if (!user.isActive) {
      return res.status(403).json({ message: 'Your account is pending activation by regional administrators.' });
    }

    const token = signToken(user.id, user.role);

    return res.status(200).json({
      status: 'success',
      token,
      user: publicUser(user)
    });
  } catch (error) {
    console.error('Staff OTP Verify Error:', error);
    return res.status(500).json({ message: 'Server error during OTP sign-in.' });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: USER_INCLUDE
    });

    if (!user) {
      return res.status(404).json({ message: 'User profile not found.' });
    }

    res.status(200).json({
      status: 'success',
      user: publicUser(user)
    });
  } catch (error) {
    console.error('GetMe Error:', error);
    res.status(500).json({ message: 'Server error retrieving active session profile.' });
  }
};

/**
 * PATCH /api/auth/me — change your own display name.
 *
 * Until this existed, `User.name` was write-once at `createPartner` (or at seed
 * time, which is why every master dashboard read "Narendra Kumar"), and the only
 * way to correct a typo in the name on somebody's sidebar was a developer with a
 * psql prompt. The seven web dashboards share one `Sidebar`, so one endpoint
 * covers all seven.
 *
 * Deliberately **name only**:
 *
 *   • `email` and `phone` are sign-in identifiers — `findByIdentifier` resolves
 *     an account by either, and `phone` additionally carries the unique index
 *     that makes "one human is one row" true. Letting a partner rewrite either
 *     from a profile box is an account-takeover surface and a lockout, not a
 *     profile edit, and it belongs behind its own verification step.
 *   • `role`, `isActive`, `parentId`, `stateName` and the rest are the hierarchy.
 *     They are set by whoever created and approved this partner, and self-service
 *     is exactly the wrong door for them.
 *
 * The route restricts to the seven dashboard roles. SHOP and EXECUTIVE have no
 * dashboard and no screen that calls this; a rider's name is on the document a
 * district partner approved, so it is not his to retype.
 *
 * ⚠️ A rename is **display only** and changes no history: `Payout`, `Settlement`
 * and the approval trail all reference `User.id`. Screens that print a partner's
 * name read it live, so old rows show the new name — which is the intent here,
 * a name being corrected rather than reassigned.
 */
export const updateMe = async (req, res) => {
  try {
    // One space between words, none at the ends — a name pasted out of a
    // spreadsheet arrives with both, and the sidebar renders it verbatim.
    const name = typeof req.body?.name === 'string'
      ? req.body.name.trim().replace(/\s+/g, ' ')
      : '';

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        message: 'Please enter a name between 2 and 80 characters.'
      });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name },
      include: USER_INCLUDE
    });

    // Same projection as `login` and `getMe` on purpose — the client overwrites
    // its stored session with this response, so a narrower shape here would
    // silently drop fields the dashboards read (`industry`, `stateName`, …).
    res.status(200).json({
      status: 'success',
      user: publicUser(user)
    });
  } catch (error) {
    console.error('UpdateMe Error:', error);
    res.status(500).json({ message: 'Server error updating your profile.' });
  }
};
