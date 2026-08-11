// An account with no password, in a schema where `password` is NOT NULL.
//
// `User.password` is required, and `login` does `bcrypt.compare(password,
// user.password)` unconditionally. A rider who registered with an OTP has no
// password and must never acquire one by accident, so the column has to hold
// something — and *what* it holds decides whether password sign-in is closed or
// merely undiscovered.
//
// Three tempting values, all wrong:
//
//   · **`''` or any short string.** `bcrypt.compare` against a non-hash returns
//     false, so it looks fine — right up until some future code path does
//     `bcrypt.hash(newPassword)` into a "blank" account, or a helper decides an
//     empty password means "unset, allow through". A value that is not a valid
//     hash is a value somebody will eventually treat as a sentinel.
//
//   · **A known default like `password123`.** That is what `createPartner` does
//     when the form leaves the field blank, and it is precisely the hole this
//     whole feature closes. Every account created that way shares one password
//     that is written down in a source file.
//
//   · **NULL.** Not available (the column is required), and `bcrypt.compare`
//     against null throws rather than returning false — a 500 instead of a 401.
//
// So: a **real bcrypt hash of 32 bytes of cryptographic randomness that is
// immediately discarded**. It is a well-formed hash, so every existing code path
// treats it as an ordinary password; it is unguessable, so no input compares
// equal to it; and the plaintext does not exist anywhere, not even in this
// process, so there is nothing to leak, reuse or write down. Password sign-in for
// these accounts is not disabled by a flag somebody can flip — it is
// arithmetically closed.
//
// Django calls this an unusable password and does the same thing for the same
// reason.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

/**
 * A password hash that nothing can ever match.
 *
 * @returns {Promise<string>} a valid bcrypt hash of a secret that no longer
 *   exists by the time this resolves.
 */
export async function unusablePassword() {
  const secret = crypto.randomBytes(32).toString('hex');
  return bcrypt.hash(secret, await bcrypt.genSalt(10));
}
