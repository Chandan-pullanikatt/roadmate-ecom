// Every endpoint the Rider app touches, in one place (Phase 3).
//
// One app, **two kinds of rider** (HANDOFF §3). A RoadMate delivery partner and
// a shop's own delivery boy sign in here, go on shift here, and walk exactly the
// same job through pickup → OTP → delivered. The delivery flow is identical; the
// ownership and the money are not, and that difference is expressed in precisely
// two places:
//
//   • `me()` carries `employerShopId` + `employerShop.name`. Set means the shop
//     pays him, so the app hides the earnings tab and says who does.
//   • `getEarnings()` answers **403 `EMPLOYED_BY_SHOP`** for that rider rather
//     than a screen of zeroes — "RoadMate owes you nothing this week" is a
//     different claim from "RoadMate is not who pays you".
//
// Nothing here needs to know which kind of rider is holding the phone. The
// backend already does: `freeRidersNear()`, `hasRiderCoverage()` and the
// assignment claim all partition on `employerShopId`, so a job that arrives in
// `listJobs()` is a job this rider is allowed to have.

/** @param {ReturnType<import('./client.js').createClient>} http */
export function riderApi(http) {
  return {
    // --- staff session -------------------------------------------------------
    // The same door as the Business app: one staff JWT, no `aud` claim, and
    // `identifier` is an email address **or** a phone number. A delivery partner
    // is far likelier to have been onboarded with a phone number than an email
    // address, which is why the sign-in screen leads with it.
    login: (identifier, password) =>
      http.post('/api/auth/login', { identifier, email: identifier, password }),
    me: () => http.get('/api/auth/me'),

    // --- the shift -----------------------------------------------------------
    /**
     * On or off. Idempotent on the way on (tapping twice does not open a second
     * `RiderShift` and inflate hours-worked reporting).
     *
     * ⚠️ A 409 on the way **off** means this rider is still carrying a job.
     * That is an outcome to show, not a retry: a parcel that belongs to nobody
     * is worse than a shift that stayed open, and mid-flight reassignment does
     * not exist. Finish or dead-run the job first.
     *
     * Coming on shift also sweeps up jobs that reached READY with nobody to
     * take them, so the response carries `jobsAssigned` — the honest reason the
     * job list is suddenly not empty.
     */
    setShift: (isOnShift, zoneNote) => http.post('/api/rider/shift', { isOnShift, zoneNote }),

    /**
     * Where the rider is now. Overwrites `lastLat`/`lastLng`; there is no
     * pings-history table by design (HANDOFF §3).
     *
     * This is not telemetry — it is what `freeRidersNear()` and
     * `hasRiderCoverage()` read, so a rider who stops reporting stops being
     * assignable and their whole area can stop being serviceable. It is sent
     * only while on shift.
     */
    reportLocation: (latitude, longitude) => http.post('/api/rider/location', { latitude, longitude }),

    // --- jobs ----------------------------------------------------------------
    /** Live jobs first, then today's finished ones. Assignment is pushed, never polled for. */
    listJobs: () => http.get('/api/rider/jobs'),

    /**
     * The goods are in the rider's hands.
     *
     * A 409 means the shop has not marked the order READY yet — the bag does not
     * exist. The response body carries `orderStatus`, which is what the screen
     * shows instead of a generic failure.
     */
    pickUp: (jobId) => http.post(`/api/rider/jobs/${jobId}/pickup`),

    /**
     * The end of the pipeline, and the one call in this app that moves money.
     *
     * **The OTP is not optional and not advisory.** It is the only thing
     * separating "delivered" and "marked delivered", so a wrong code is a 422
     * and the order does not move. There is no override in the app because
     * there is none in the API.
     *
     * `photoUrl` / `signatureUrl` are URLs, not files: the app uploads to
     * Cloudinary first (`signProofUpload` + `uploadAsset`) and sends the result
     * (PLAN §6). Both remain optional — the OTP is the delivery, and a rider
     * whose camera is refused must still be able to finish the job.
     *
     * ⚠️ Since 2026-08-09 a URL that is not an asset **we** issued a signature
     * for is a 400 `NOT_OUR_ASSET`. Send back what `uploadAsset` returned,
     * unmodified.
     */
    deliver: (jobId, proof) => http.post(`/api/rider/jobs/${jobId}/deliver`, proof),

    /**
     * One-shot permission to upload one proof-of-delivery asset.
     *
     * `kind` is `POD_PHOTO` or `POD_SIGNATURE`. The response carries
     * `live: false` when the server has no Cloudinary credentials — the app
     * hides the camera rather than offering a button that dies at the upload,
     * the same call this app already makes everywhere else.
     */
    signProofUpload: (kind, ownerRef) =>
      http.post('/api/rider/uploads/signature', { kind, ownerRef }),

    /** A trip that was made and had nothing at the end of it. The platform pays. */
    reportDeadRun: (jobId, reason) => http.post(`/api/rider/jobs/${jobId}/dead-run`, { reason }),

    // --- money ---------------------------------------------------------------
    /**
     * Today, what is unsettled, what has been paid, and the rates themselves.
     *
     * Every figure comes from frozen `DeliveryJob.riderEarning` columns and
     * `RiderSettlement` rows — the app never recomputes a fee, so the screen
     * cannot disagree with the ledger. The **rates** are shown on purpose,
     * unlike `commission_percent`: a rider is entitled to know how their own pay
     * is worked out, and it is their rate rather than a cut the platform takes.
     *
     * ⚠️ 403 `EMPLOYED_BY_SHOP` for a shop's own delivery boy. Handled by not
     * showing him the tab, and defended here in case he deep-links to it.
     */
    getEarnings: () => http.get('/api/rider/earnings'),

    /** COD cash this rider is holding right now, and has not handed in. */
    getRemittance: () => http.get('/api/rider/remittance'),
    /**
     * Hand it all in at once. A conditional `updateMany` re-asserting
     * `cashRemittedAt: null`, so a double tap or a delivery landing mid-request
     * cannot double-count or lose a payment that arrived in between.
     */
    remitCash: () => http.post('/api/rider/remittance'),

    // --- push ----------------------------------------------------------------
    /** Idempotent: `token` is unique, so registration is an upsert. */
    registerDevice: (token, platform) => http.post('/api/devices', { token, platform })
  };
}
