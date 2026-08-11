// Becoming a delivery partner — the only surface in this package with **no
// session behind it** (2026-08-11).
//
// Every other api in `@roadmate/api` is constructed around a token store: a
// signed-in shop, rider or customer. An applicant has none. He has a phone number
// he can prove, and — for fifteen minutes after proving it — a **ticket**.
//
// So this is a separate api rather than more methods on `riderApi`, for the same
// reason `customerApi` is separate from it: the client instance is built for an
// audience, and this one's audience is "nobody yet". Give it a client with no
// `getToken` at all. Nothing here sends an `Authorization` header; the ticket
// travels in the body, because it is not a session and must not be mistaken for
// one by an interceptor that assumes a Bearer token means signed in.
//
// ── The shape of the flow ───────────────────────────────────────────────────
//
//   getCoverage()            → which state/district/region to pick from
//   requestOtp(phone)        → a code
//   verifyOtp(phone, code)   → **four possible outcomes**, see below
//   signDocUpload(ticket)    → a signature for one licence/Aadhaar photo
//   register(ticket, details)→ the application
//
// `verifyOtp` is the interesting one and the app must branch on `outcome`:
//
//   `SIGNED_IN`   `{ token, user }` — an approved rider. Identical to what `POST
//                 /api/auth/login` returns, so the session stores it unchanged.
//   `PENDING`     `{ application }` — already applied. **No token**, by design:
//                 there is nothing to sign in to yet. Re-verifying is how a rider
//                 checks back, which is why this outcome carries the application
//                 rather than only a message.
//   `DEACTIVATED` `{ employerShop }` — the account exists and was switched off.
//                 Not the same sentence as PENDING, and showing "we are still
//                 reviewing you" to somebody a shop released would have them
//                 waiting forever on a decision already taken.
//   `NEW`         `{ ticket, vehicleTypes }` — go and fill the form.
//
// A **403 `WRONG_APP`** rather than an outcome when the number belongs to a shop
// owner or a manufacturer: it is an error, the app has an `APP_FOR_ROLE` table for
// it, and the body carries `role` so the sentence is composed in one place.

/**
 * @param {ReturnType<import('./client.js').createClient>} http a client built
 *   **without** `getToken` — there is no session here to read one from.
 */
export function riderSignupApi(http) {
  return {
    /**
     * Where RoadMate has somebody on the ground, as `{ states: [{ state,
     * districts: [{ district, regions }] }] }`. Public; no code needed.
     *
     * ⚠️ **Render these as pickers and never as free text.** The strings are the
     * approving partners' own, and `getPendingApprovals` matches them exactly — an
     * applicant who types "Ernakulam District" where his district partner has
     * "Ernakulam" is not rejected, he is *invisible* to every approval queue.
     * `register` refuses an uncovered district for the same reason, so a typed
     * field would only produce a 400 the picker cannot cause.
     *
     * An empty list is meaningful: RoadMate has no district desk anywhere the
     * applicant could join yet, and the honest screen says so.
     */
    getCoverage: () => http.get('/api/geo/coverage'),

    /**
     * Ask for a code. Answers identically for a number with an account, a number
     * mid-application and a number nobody has seen — which of the three it is
     * comes back from `verifyOtp`, after the code proves who is asking.
     *
     * A 429 is a rate limit (5 per number per 10 minutes), not a failure to retry:
     * asking again is exactly what is being refused.
     */
    requestOtp: (phone) => http.post('/api/rider/auth/otp/request', { phone }),

    /** Consume the code. Branch on `outcome` — see the header. */
    verifyOtp: (phone, code) => http.post('/api/rider/auth/otp/verify', { phone, code }),

    /**
     * A one-shot authorisation to upload one identity document.
     *
     * `live: false` means the deployment has no file storage, and the form must
     * then **hide the camera rather than disable it** — documents are optional at
     * the API precisely so registration still works there. The same rule the job
     * screen follows about affordances that cannot work.
     */
    signDocUpload: (ticket, ownerRef) =>
      http.post('/api/rider/auth/uploads/signature', { ticket, kind: 'RIDER_DOC', ownerRef }),

    /**
     * File the application. 201 and the rider is pending; nothing else happens
     * until a district or regional partner approves him.
     *
     * ⚠️ **The phone number is not a parameter, and must not be added as one.**
     * The server reads it out of the ticket. That is what stops an application
     * being filed against somebody else's number, and a `phone` field here would
     * be ignored by the server while looking authoritative in this file.
     *
     * `reason` on a 400 is what the form highlights: `AREA_REQUIRED`,
     * `AREA_NOT_COVERED`, `REGION_NOT_COVERED`, `VEHICLE_REQUIRED`,
     * `VEHICLE_NUMBER_REQUIRED`, `LICENCE_REQUIRED`, `AADHAAR_REQUIRED`,
     * `NOT_OUR_ASSET` (with `field`), `NAME_REQUIRED`. A 409 `PHONE_TAKEN` means
     * an account appeared for this number while the form was open — go and sign
     * in. A 401 `TICKET_INVALID` means the fifteen minutes ran out: verify again.
     */
    register: (ticket, details) => http.post('/api/rider/auth/register', { ticket, ...details })
  };
}
