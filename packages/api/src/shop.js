// Every endpoint the shop role touches, in one place.
//
// The shop is the hinge (HANDOFF §1): it answers consumer orders with the B2C
// endpoints and restocks itself with the B2B ones, and both halves are below.
// Screens call these; no screen builds a URL.

import { billingApi } from './billing.js';

/** @param {ReturnType<import('./client.js').createClient>} http */
export function shopApi(http) {
  return {
    // The partner's own subscription: the free trial, and the bills after it.
    // One definition, shared with the other surface (HANDOFF §7ter).
    ...billingApi(http),

    // --- staff session -------------------------------------------------------
    /**
     * Staff sign-in. `identifier` is an email address **or** a phone number —
     * the server decides which by looking at it and normalises the phone case
     * through the same rules the customer side uses.
     *
     * `email` is still sent alongside it, and the server still accepts that
     * field, because the 7 web dashboards have always posted `{ email }` and
     * this endpoint is shared with them. Sending both costs one key and means
     * a server that has not been redeployed yet still authenticates an email.
     */
    login: (identifier, password) =>
      http.post('/api/auth/login', { identifier, email: identifier, password }),

    /**
     * The second door: a phone number and a code, no password (2026-08-12).
     *
     * `verifyLoginOtp` resolves to **exactly** what `login` resolves to — same
     * token, same user shape — so `session.js` stores the result of either
     * without branching. Anything that made these two differ would be a bug in
     * every screen that reads the session, not just in sign-in.
     *
     * `requestLoginOtp` answers the same way for a number with an account and a
     * number without one; which it is comes back from `verifyLoginOtp`, after
     * the code has proved the caller holds the number.
     */
    requestLoginOtp: (phone) => http.post('/api/auth/otp/request', { phone }),
    verifyLoginOtp: (phone, code) => http.post('/api/auth/otp/verify', { phone, code }),

    me: () => http.get('/api/auth/me'),

    // --- the storefront switch ----------------------------------------------
    // `isOpen` is what takes the shop in and out of `rankCandidateShops`, so
    // this toggle is the difference between receiving orders and not.
    getStorefront: () => http.get('/api/shop/storefront'),
    setStorefront: (patch) => http.patch('/api/shop/storefront', patch),

    // --- consumer orders (B2C) ----------------------------------------------
    /** Live offers with their countdowns. `secondsRemaining` is a duration. */
    listOffers: () => http.get('/api/shop/offers'),

    /**
     * Accept is a CLAIM, not an update.
     *
     * A 409 means the sweeper already rerouted this order to another shop — the
     * order is gone, and the only correct response is to tell the shop it moved
     * on and refresh the list. Retrying is meaningless: there is nothing left to
     * win. (HANDOFF §1.5 / PLAN §1.6.)
     */
    acceptOffer: (orderId) => http.post(`/api/shop/offers/${orderId}/accept`),
    rejectOffer: (orderId, reason) => http.post(`/api/shop/offers/${orderId}/reject`, { reason }),

    listOrders: () => http.get('/api/shop/orders'),
    /** ACCEPTED → PREPARING → READY. READY is what summons a rider. */
    setOrderStatus: (orderId, status) => http.patch(`/api/shop/orders/${orderId}/status`, { status }),
    /** The expensive admission: accepted, then found the shelf empty. */
    reportStockout: (orderId, reason) => http.post(`/api/shop/orders/${orderId}/stockout`, { reason }),

    // --- stock ---------------------------------------------------------------
    listInventory: (search) => http.get('/api/shop/inventory', { query: { search } }),
    addInventory: (item) => http.post('/api/shop/inventory', item),
    /** A 409 `BELOW_RESERVED` means stock is promised to an order in flight. */
    updateInventory: (id, patch) => http.patch(`/api/shop/inventory/${id}`, patch),
    /** The only way back from a SKU auto-hidden after repeated stockouts. */
    confirmInventory: (id, quantity) =>
      http.post(`/api/shop/inventory/${id}/confirm`, quantity === undefined ? {} : { quantity }),

    // --- the shop's own delivery staff (HANDOFF §3) --------------------------
    // A shop either uses RoadMate's delivery partners or its own delivery boys,
    // and `setStorefront({ usesOwnRiders })` above is that switch. These three
    // are the roster behind it.
    //
    // The shop hires its own staff because a field executive does not know a
    // shop's employees. A hire is an ordinary rider account — he signs into
    // RoadMate Rider and is tracked exactly like a platform partner; the only
    // difference is that he may only be given this shop's orders.
    listRiders: () => http.get('/api/shop/riders'),
    /** A 409 `PHONE_TAKEN` means that number is already a RoadMate account. */
    addRider: (rider) => http.post('/api/shop/riders', rider),
    /**
     * Vehicle details, or `{ isActive: false }` to take somebody off the roster.
     *
     * A 409 `RIDER_ON_JOB` means they are out on a delivery — the same reason a
     * rider cannot go off shift mid-job. It is an outcome to show, not a retry.
     */
    updateRider: (riderId, patch) => http.patch(`/api/shop/riders/${riderId}`, patch),

    // --- vouchers (NO_DELIVERY and SERVICE_BOOKING: the counter and the gate) --
    // One pair of verbs for both. A turf booking is a voucher whose validity
    // window is the booked hour, so `NOT_YET_VALID` here means "you're early"
    // and `EXPIRED` means "that slot has passed".
    lookupVoucher: (code) => http.get(`/api/shop/vouchers/${encodeURIComponent(code)}`),
    redeemVoucher: (code) => http.post('/api/shop/vouchers/redeem', { code }),

    // --- slots (SERVICE_BOOKING: "Manage Slots") -----------------------------
    /** The venue's calendar. `from`/`to` are ISO strings; past hours are allowed. */
    listSlots: (query) => http.get('/api/shop/slots', { query }),

    /**
     * Open hours for sale. Takes a window and cuts it into slots, because that
     * is how a venue thinks ("we're open 6 to 11, hour slots").
     *
     * Re-running the same window is a **skip, not a duplicate** — the response
     * says how many were `created` and how many `skipped`.
     */
    createSlots: (body) => http.post('/api/shop/slots', body),

    /** Close, reopen or reprice one hour. 409 `CAPACITY_BELOW_BOOKED` is an outcome. */
    updateSlot: (slotId, patch) => http.patch(`/api/shop/slots/${slotId}`, patch),

    /**
     * Remove an hour nobody bought. 409 `SLOT_HAS_BOOKINGS` means somebody holds
     * a voucher for it — close it instead, which is what the screen offers.
     */
    deleteSlot: (slotId) => http.del(`/api/shop/slots/${slotId}`),

    // --- restock (B2B) -------------------------------------------------------
    // These are the existing trade endpoints the 7 dashboards already use, so
    // their money is `Float` and their statuses are capitalised strings. See
    // `formatAmount` in @roadmate/ui for why that distinction is load-bearing.
    // `industryId` is passed explicitly and always: with no query at all this
    // endpoint defaults a SHOP to *its own* products, which for a shop that
    // manufactures nothing is an empty screen. Restocking means browsing the
    // industry's catalogue, and each product's `owner` is the seller to order
    // from.
    listCatalog: (industryId) => http.get('/api/products', { query: { industryId } }),
    listTradeOrders: () => http.get('/api/orders'),
    createTradeOrder: (order) => http.post('/api/orders/create', order)
  };
}
