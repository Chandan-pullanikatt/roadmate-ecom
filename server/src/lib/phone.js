// One definition of what an Indian mobile number is, for both sides of the
// platform.
//
// This was written for `Customer` (§1.1) and lived inside
// `customerAuthController.js`. Staff sign-in now accepts a phone number too, so
// it has moved here rather than being copied — two normalisers is how "+91 98765
// 00011" and "9876500011" end up as two rows for one human, and on the staff
// side that would be two accounts for one shop owner.
//
// The rule: 10 digits, Indian mobile numbering (leading 6–9), with `+91`, a
// leading `0`, spaces and hyphens accepted on input and normalised away. The
// **normalised** form is what is stored and what is compared, which is what
// makes the unique index on `User.phone` mean "one human, one row".

/** @returns {string|null} the 10-digit form, or null if it is not a mobile number. */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw
    .replace(/[\s-()]/g, '')
    .replace(/^\+91/, '')
    .replace(/^91(?=\d{10}$)/, '')
    .replace(/^0/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * Is this input a phone number rather than an email address?
 *
 * Used by staff sign-in to decide which column to look in. Deliberately not
 * "does it contain an @" — a typo'd email with no @ should fail as a bad email,
 * not be silently looked up as a phone number and reported as "no such phone".
 * So: anything that is only digits and phone punctuation is treated as a phone
 * attempt, everything else as an email attempt.
 */
export function looksLikePhone(raw) {
  return typeof raw === 'string' && /^[+\d][\d\s\-()]*$/.test(raw.trim());
}
