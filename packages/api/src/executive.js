// Every endpoint the three executive roles touch (Distributor, Manufacturer,
// Regional) — the existing B2B endpoints the 7 dashboards already use.
//
// There is no executive-specific backend: `dashboardController.getOverview`
// already branches per role, and `partnerController` / `orderController` /
// `productController` are the same endpoints a dashboard calls. This file is
// only "what they are and what they mean" for the app, same as `shopApi`.
//
// Money here is a `Float` throughout — B2B, never Decimal — so every screen
// that reads it goes through `formatAmount`, not `formatINR`.

import { billingApi } from './billing.js';

/** @param {ReturnType<import('./client.js').createClient>} http */
export function executiveApi(http) {
  return {
    // The partner's own subscription: the free trial, and the bills after it.
    // One definition, shared with the other surface (HANDOFF §7ter).
    ...billingApi(http),

    // --- dashboard -------------------------------------------------------
    // Shape differs per role (`stats` keys), which is why the app keeps its
    // own per-role field list rather than rendering this generically.
    getOverview: (period) => http.get('/api/dashboard/overview', { query: { period } }),

    // --- network (downstream partners) ------------------------------------
    // Not every role has both halves: `getPendingApprovals` only returns rows
    // for REGIONAL among these three (Distributor/Manufacturer onboard
    // nobody); `getActivePartners` returns shops for REGIONAL and
    // DISTRIBUTOR, and an empty list for MANUFACTURER — the screen hides the
    // tab for a role with nothing to show rather than showing it empty.
    getPendingApprovals: () => http.get('/api/partners/pending'),
    getActivePartners: () => http.get('/api/partners/active'),
    approvePartner: (id) => http.post(`/api/partners/${id}/approve`),
    rejectPartner: (id) => http.post(`/api/partners/${id}/reject`),

    // --- B2B orders --------------------------------------------------------
    // `getOrders` already scopes itself by role server-side: buyer+seller
    // view for Manufacturer/Distributor, a location/industry-scoped read for
    // Regional (PLAN's "admin" branch). Nothing here re-filters it.
    // ⚠️ Named `…TradeOrder…`, not `listOrders`/`setOrderStatus`, because the
    // Business app merges this surface with `shopApi` and those two names are
    // already the *consumer* order inbox there. Two different order flows meet
    // in this app (HANDOFF §1); a collision here would silently replace the
    // shop's inbox with its purchase history.
    // `shopApi` defines this name too, against the same endpoint and the same
    // response — the shop's purchase history and an executive's order book are
    // literally one server-side query scoped by role. Merging them is a no-op.
    listTradeOrders: () => http.get('/api/orders'),
    /** Pending → Approved → Dispatched → Delivered. Sellers only. */
    setTradeOrderStatus: (id, status) => http.put(`/api/orders/${id}/status`, { status }),

    // --- catalog (Manufacturer sells to Distributor, Distributor to Shop) --
    listProducts: () => http.get('/api/products'),
    createProduct: (product) => http.post('/api/products/create', product),
    // PUT, not PATCH — the existing route is `app.put('/api/products/:id')`,
    // and the controller already treats undefined fields as "leave alone", so
    // it behaves like a patch despite the verb.
    updateProduct: (id, patch) => http.put(`/api/products/${id}`, patch),
    deleteProduct: (id) => http.del(`/api/products/${id}`),

    // --- payouts -------------------------------------------------------
    // The commission-split recipients (STATE/IND_STATE/DISTRICT/REGIONAL/
    // MASTER) per `orderController.updateOrderStatus`. Regional is the only
    // one of these three roles that receives one.
    listPayouts: () => http.get('/api/payouts')
  };
}
