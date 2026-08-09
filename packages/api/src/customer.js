// Every endpoint the Customer app touches, in one place (Phase 4).
//
// **This is the other audience.** A customer token carries `aud:
// roadmate-customer` and is rejected by the staff guard; a staff token has no
// `aud` and is rejected by `protectCustomer`. They are not variants of each
// other, which is why `customerApi` and `shopApi`/`riderApi` never share a
// client instance even though they share a `createClient`.
//
// Two things worth knowing before adding to this file:
//
//   • **A cart never spans shops.** `GET /api/customer/cart` returns *carts*,
//     plural — one per shop the customer has added from. Adding from a second
//     shop opens a second cart rather than moving the first, and checkout is
//     per cart. Anything here that says "the cart" is wrong.
//   • **Placing an order does not bind a shop.** The response's
//     `firstCandidateShop` is the shop whose shelf is holding the reservation,
//     not the shop that will fulfil it: the accept window can time out and the
//     order reroutes (HANDOFF §3). The tracking screen must read `order.shop`,
//     which stays null until somebody accepts.

/** @param {ReturnType<import('./client.js').createClient>} http */
export function customerApi(http) {
  return {
    // --- session -------------------------------------------------------------
    /**
     * Ask for a code. The SMS leg is MSG91 and stubs out without credentials,
     * so outside production the code comes back in the response body — that is
     * what makes the flow testable today, and a server test pins that
     * production never leaks it.
     *
     * A 429 is a rate limit (5 per phone per 10 minutes), not a failure to
     * retry: asking again is exactly what is being refused.
     */
    requestOtp: (phone) => http.post('/api/customer/auth/otp/request', { phone }),
    /**
     * Consume the code and get a 30-day customer JWT.
     *
     * Every failure answers the same "Invalid or expired OTP", deliberately —
     * nothing here tells a stranger which phone numbers are on the platform. A
     * 429 means five wrong guesses burned the code; a new one must be requested.
     */
    verifyOtp: (phone, code) => http.post('/api/customer/auth/otp/verify', { phone, code }),
    me: () => http.get('/api/customer/me'),

    // --- where, and what kind of shopping ------------------------------------
    /** The seven industries. Public, and the only endpoint here that needs no token. */
    listIndustries: () => http.get('/api/industries'),

    /**
     * Can we sell to this point at all, and which shops.
     *
     * `serviceable: false` always carries a `reason` — `NO_SHOP` (nobody is in
     * range) or `NO_RIDER` (shops are in range but nobody can collect from
     * them). Those are different sentences to a customer and the app says both.
     */
    getServiceable: (lat, lng, industryId) =>
      http.get('/api/customer/serviceable', { query: { lat, lng, industryId } }),

    /** Browse by shop. Only rows the shop can actually sell come back. */
    getShopProducts: (shopId, query) =>
      http.get(`/api/customer/shops/${shopId}/products`, { query }),

    /**
     * Browse by product — the same product across every serviceable shop,
     * cheapest offer first. The other half of the hybrid browse (HANDOFF §3),
     * not a search box over the first half.
     */
    searchProducts: (query) => http.get('/api/customer/products', { query }),

    // --- address book --------------------------------------------------------
    /** Coordinates are required, not optional: an address that cannot be routed is not one. */
    listAddresses: () => http.get('/api/customer/addresses'),
    createAddress: (address) => http.post('/api/customer/addresses', address),
    /** A 409 means an order already used it. History keeps the row. */
    deleteAddress: (addressId) => http.del(`/api/customer/addresses/${addressId}`),

    // --- carts ---------------------------------------------------------------
    /** Carts, plural — one per shop. See the note at the top of this file. */
    listCarts: (shopId) => http.get('/api/customer/cart', { query: { shopId } }),
    /**
     * A 409 here is the shelf answering, with `availableQty` in the body: the
     * quantity asked for is more than this shop can sell. Adding does **not**
     * reserve anything — reservation happens once, at placement.
     */
    addCartItem: (item) => http.post('/api/customer/cart/items', item),
    /** Quantity 0 removes the line. */
    updateCartItem: (itemId, quantity) =>
      http.patch(`/api/customer/cart/items/${itemId}`, { quantity }),
    removeCartItem: (itemId) => http.del(`/api/customer/cart/items/${itemId}`),
    clearCart: (cartId) => http.del(`/api/customer/cart/${cartId}`),

    // --- orders --------------------------------------------------------------
    /**
     * The concurrency-critical call, and the one whose failures are all
     * meaningful rather than technical:
     *
     *   409 — a line just sold out while the cart sat there (`productId` says
     *         which). Not a retry: the cart has to change first.
     *   422 `NO_RIDER` / `NOT_SERVICEABLE` — nobody can collect from this shop
     *         for this address right now.
     *   422 `PREPAID_REQUIRED` — a membership is paid online or not at all.
     */
    placeOrder: (order) => http.post('/api/customer/orders', order),
    listOrders: () => http.get('/api/customer/orders'),
    getOrder: (orderId) => http.get(`/api/customer/orders/${orderId}`),

    /**
     * PREPAID only, and idempotent — a second call returns the same gateway
     * order, because two would leave the first uncompletable.
     *
     * ⚠️ Razorpay stubs out on the server until its three env vars are set, so
     * this returns a placeholder until the client's account exists. The app
     * gates the whole prepaid option on a key being configured rather than
     * offering a payment it cannot take (`src/config.js`).
     */
    createRazorpayOrder: (orderId) =>
      http.post(`/api/customer/orders/${orderId}/razorpay-order`),

    /**
     * VERIFY_AND_DELIVER. Takes a **URL**, not a file — which is exactly why
     * this endpoint did not change when file storage landed (2026-08-09,
     * PLAN §6). The app now uploads to Cloudinary first with
     * `signPrescriptionUpload` + `uploadAsset` and posts the resulting URL here.
     *
     * ⚠️ A URL we did not issue a signature for is a 400 `NOT_OUR_ASSET`.
     */
    uploadPrescription: (orderId, imageUrl) =>
      http.post(`/api/customer/orders/${orderId}/prescription`, { imageUrl }),

    /**
     * One-shot permission to upload one prescription image.
     *
     * The asset is stored **private/authenticated** — a medical record, not a
     * product photo — and that is baked into the signature the server computes,
     * so this app could not make it public if it tried. `live: false` means the
     * server has no storage credentials, and the screen says so instead of
     * opening a camera whose photo has nowhere to go.
     */
    signPrescriptionUpload: (orderId) =>
      http.post('/api/customer/uploads/signature', {
        kind: 'PRESCRIPTION',
        ownerRef: `order${orderId}`
      }),

    // --- push ----------------------------------------------------------------
    /** The customer half of `registerDevice`; `DeviceToken_owner_xor` keeps the two apart. */
    registerDevice: (token, platform) => http.post('/api/customer/devices', { token, platform })
  };
}
