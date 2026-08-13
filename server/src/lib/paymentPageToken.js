// The ticket that opens one order's checkout page in a browser (2026-08-12).
//
// The problem it solves. Razorpay's checkout is a **web** widget, and this
// platform's three apps carry no WebView and no native Razorpay SDK — both are
// native dependencies, and a native dependency crashes every installed dev
// client across three codebases (HANDOFF §6, the `expo-linear-gradient` note).
// So the app hands off to the phone's own browser, exactly as the Rider app
// hands off to Google Maps rather than embedding a map.
//
// A browser has no session. `protectCustomer` reads a JWT the app holds in
// SecureStore, and a URL opened in Chrome carries none of that — so the URL
// itself has to be the authorisation, and it has to be one that is worthless
// for anything else.
//
// FOUR PROPERTIES, ALL LOAD-BEARING:
//
//   1. **Its own audience.** `roadmate-payment-page`, so `protect` rejects it
//      (no `userId`) and `protectCustomer` rejects it (wrong `aud`). Same
//      mechanism as `riderSignupToken.js`: one secret, three audiences, and no
//      ticket is ever presentable as a session.
//
//   2. **Bound to one order.** The order id is *in* the token and the page
//      compares it against the id in the path. A ticket for order 41 cannot
//      open order 42, so the URL is not an enumeration handle over other
//      people's bills.
//
//   3. **Short.** Fifteen minutes — long enough to reach for a second phone or
//      re-open a link that was fumbled, short enough that a URL left in browser
//      history or a screenshot is expired by the time anybody finds it. Getting
//      another costs one tap in the app.
//
//   4. **It authorises nothing but paying.** Everything the page can do is show
//      one amount and open Razorpay against one gateway order. It cannot read
//      the customer's other orders, cannot change an address, and — this is the
//      important half — **it cannot mark anything paid.** Only the signed
//      webhook does that (`paymentController.razorpayWebhook`). A leaked ticket
//      lets a stranger *pay somebody else's bill*, which is not a threat model
//      worth defending against.
import jwt from 'jsonwebtoken';

export const PAYMENT_PAGE_AUDIENCE = 'roadmate-payment-page';

const JWT_SECRET = () => process.env.JWT_SECRET || 'roadmate_secret_key_2026_secure_hash';

/** Long enough to recover from a fumbled tap; short enough to be worthless later. */
export const PAYMENT_PAGE_TTL_SECONDS = 15 * 60;

/** @param {number} orderId the `ConsumerOrder` this ticket may open, and only this one. */
export const signPaymentPageToken = (orderId) =>
  jwt.sign({ orderId, typ: 'payment-page' }, JWT_SECRET(), {
    audience: PAYMENT_PAGE_AUDIENCE,
    expiresIn: PAYMENT_PAGE_TTL_SECONDS
  });

/**
 * The order id this ticket opens, or null if it opens nothing.
 *
 * Null rather than a throw, for the same reason `phoneFromSignupToken` does it:
 * every caller's answer to a bad ticket is one page saying "this link has
 * expired", and *why* it was bad is not a branch worth writing — nor one worth
 * telling a browser.
 */
export function orderIdFromPaymentPageToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const decoded = jwt.verify(raw.trim(), JWT_SECRET(), { audience: PAYMENT_PAGE_AUDIENCE });
    return Number.isInteger(decoded?.orderId) && decoded.orderId > 0 ? decoded.orderId : null;
  } catch {
    return null;
  }
}
