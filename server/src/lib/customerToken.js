// Customer JWTs are a *separate* audience from staff JWTs.
//
// Staff tokens resolve to `User`; customer tokens resolve to `Customer` — a
// different table with a different id space, so an id collision between the two
// is guaranteed, not hypothetical. The audience claim is what stops a token
// issued for one guard from being accepted by the other.
import jwt from 'jsonwebtoken';

export const CUSTOMER_AUDIENCE = 'roadmate-customer';

const JWT_SECRET = () => process.env.JWT_SECRET || 'roadmate_secret_key_2026_secure_hash';

// Long-lived on purpose: this is a mobile app, and re-login costs an SMS.
const CUSTOMER_TOKEN_TTL = '30d';

export const signCustomerToken = (customerId) =>
  jwt.sign({ customerId, typ: 'customer' }, JWT_SECRET(), {
    audience: CUSTOMER_AUDIENCE,
    expiresIn: CUSTOMER_TOKEN_TTL
  });

/** Throws if the token is invalid, expired, or not a customer-audience token. */
export const verifyCustomerToken = (token) =>
  jwt.verify(token, JWT_SECRET(), { audience: CUSTOMER_AUDIENCE });
