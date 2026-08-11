// The ticket that says "this person holds this phone number", and nothing else.
//
// Rider self-registration (2026-08-11) has a problem the other two audiences do
// not. A customer's OTP *is* their session: verify the code, get a 30-day token,
// done. A rider applying to join has no account yet — approval may be days
// away — so there is nothing to issue a session for. But the registration form
// is long (name, area, vehicle, licence, Aadhaar, two document photos), and
// asking for the code at the *end* would mean a stranger could post an
// application for somebody else's phone number and have it sit in a district
// partner's approval queue.
//
// So the phone is proven first and the proof is carried forward. `verifyOtp`
// consumes the code and mints one of these; `register` and the document-upload
// signature both require it and read the phone **out of the ticket**, never out
// of the request body. A caller cannot register a number they did not verify,
// because there is no field in which to say one.
//
// THREE PROPERTIES, ALL LOAD-BEARING:
//
//   1. **Its own audience.** `roadmate-rider-signup`, so it is not a staff token
//      and not a customer token. `protect` rejects it (no `userId`), and
//      `protectCustomer` rejects it (wrong `aud`) — a ticket cannot be presented
//      as a session even though it is signed with the same secret. The mirror of
//      what `customerToken.js` does for the other direction.
//
//   2. **Short.** Fifteen minutes: long enough to fill a form and take two
//      photos on a bad connection, short enough that a ticket leaked out of a
//      log is worthless. It is not a credential anybody should be holding
//      overnight, and re-proving the phone costs one SMS.
//
//   3. **It authorises nothing but this.** The ticket cannot read, cannot list,
//      cannot sign in. It can create one pending application and sign uploads of
//      one `RIDER_DOC` kind. Everything a rider can actually *do* still requires
//      an approved account and a real staff JWT.
import jwt from 'jsonwebtoken';

export const RIDER_SIGNUP_AUDIENCE = 'roadmate-rider-signup';

const JWT_SECRET = () => process.env.JWT_SECRET || 'roadmate_secret_key_2026_secure_hash';

/** Long enough for a form and two photos; short enough to be worthless if leaked. */
export const RIDER_SIGNUP_TTL_SECONDS = 15 * 60;

/** @param {string} phone the **normalised** 10-digit number the OTP proved. */
export const signRiderSignupToken = (phone) =>
  jwt.sign({ phone, typ: 'rider-signup' }, JWT_SECRET(), {
    audience: RIDER_SIGNUP_AUDIENCE,
    expiresIn: RIDER_SIGNUP_TTL_SECONDS
  });

/**
 * The phone number this ticket proves, or null if it proves nothing.
 *
 * Returns null rather than throwing: every caller's answer to a bad ticket is
 * the same 401, and there is no branch worth writing on *why* it was bad.
 */
export function phoneFromSignupToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const decoded = jwt.verify(raw.trim(), JWT_SECRET(), { audience: RIDER_SIGNUP_AUDIENCE });
    // Belt and braces on top of the audience check: a token with the right `aud`
    // but no phone is not a ticket, whatever else it is.
    return typeof decoded?.phone === 'string' && decoded.phone ? decoded.phone : null;
  } catch {
    return null;
  }
}
