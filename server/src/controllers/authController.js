import prisma from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { normalizePhone, looksLikePhone } from '../lib/phone.js';

const JWT_SECRET = process.env.JWT_SECRET || 'roadmate_secret_key_2026_secure_hash';

// Generate Token
const signToken = (userId, role) => {
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

const USER_INCLUDE = {
  industry: {
    select: {
      id: true,
      name: true,
      slug: true
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
 */
function publicUser(user) {
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
    // Null for a RoadMate delivery partner. Set for a shop's own delivery boy,
    // which is what hides the platform earnings screen from him.
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
