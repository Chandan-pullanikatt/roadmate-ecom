// The partner's own subscription — the free trial, and the bills after it.
// HANDOFF §7ter. Shared by `shopApi` and `executiveApi` because the three
// billable roles (SHOP, DISTRIBUTOR, MANUFACTURER) span both surfaces, and one
// of them is a shop while two are executives.
//
// Money here is a fixed-2 **string** (`amountDue`, `monthlyFee`, each invoice's
// `amount`) — it is B2C-side Decimal on the server, so it is formatted with
// `formatINR` and never `formatAmount`, and never `parseFloat`.

/** @param {ReturnType<import('./client.js').createClient>} http */
export function billingApi(http) {
  return {
    /**
     * Everything the banner and the billing screen need, in one call.
     *
     * `billable: false` for a role that is never charged — a REGIONAL partner
     * is paid a share of the commission pool and a rider is paid per delivery,
     * so neither has a subscription. Render nothing rather than an empty screen.
     *
     * `phase` is derived server-side from the clock and the invoices, never
     * stored: `TRIAL` · `ACTIVE` · `PAST_DUE` · `CANCELLED` · `NONE`.
     *
     * ⚠️ `trialStartKnown: false` is a real state, not an error. A partner
     * approved before approval dates were recorded has no date to count three
     * months from, so nothing is billed and somebody has to decide. Say that;
     * do not render it as "trial ends —".
     */
    getBilling: () => http.get('/api/billing/me'),

    /**
     * Ask for a way to pay one invoice.
     *
     * **Never call this twice for one invoice expecting two links** — the
     * server returns the existing one (200 with `reused: true`) precisely
     * because two links is two ways to pay one month.
     *
     * `live: false` on the response means the server has no Razorpay
     * credentials and the URL is a stub nobody can pay. Say so rather than
     * opening it — the same rule the Customer app applies to prepaid checkout.
     */
    createPayLink: (invoiceId) => http.post(`/api/billing/invoices/${invoiceId}/pay-link`)
  };
}
