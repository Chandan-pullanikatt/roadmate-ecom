# Grill: District dashboard — Regions rename + live revenue drill-downs
Date: 2026-06-19

## Intent
Make the District Partner "Revenue Summary" table real and demo-ready for a client.
Rename the "Partnerships" revenue category to "Regions", fill the empty (—) cells with
real backend data, and make every row a clickable drill-down to a dedicated page that
lists the underlying partners with their individual revenue.

## Constraints
- No hardcoded mock data in the frontend — values must come from the backend.
- Data must be seeded into the (Neon) production database so the demo shows real numbers.
- Needs to look populated, not single-row, for a client demo.

## Key decisions
- Decision: Rename "Partnerships" → "Regions" in both REV_CATEGORIES and REVENUE_TABLE.
  Reason: user request. Alternative rejected: label-only swap with no behavior (user wants live data + drill-down).
- Decision: Each of the 4 rows becomes a clickable drill-down. Reason: explicit ask.
- Decision: Revenue basis per row:
    - Regions = sum of real ORDER revenue across the district's regions; Count = # regions.
    - Shop Subscriptions = ₹5,000 × #shops; Delivery = ₹2,000 × #riders; Distributor = ₹10,000 × #distributors.
    - "My Earnings" = Total Collected × row share %.
  Reason: counts come from real seeded users; fees are the rates already in DistrictDashboard.jsx:30-32.
  Alternative rejected: deriving all rows purely from orders (no per-category order data exists).
- Decision: Build NEW dedicated drill-down pages (e.g. /district/revenue/regions), not reuse
  existing regional-partners/distributors pages. Reason: cleaner for demo, no disturbance to existing pages.
- Decision: Seed 4–5 regions under the district, each with 2–3 shops and some orders.
  Reason: single-row data looks empty in a demo.

## Surfaced assumptions
- Schema has NO subscription/revenue-category model; revenue only ever comes from Orders
  (dashboardController district revenue = sum of order totalAmount). Subscription "revenue"
  is therefore derived from real user counts × fixed onboarding fees, not stored transactions.
- `User.monthlyCost` exists but is not the chosen basis; fixed onboarding fees are used instead.
- Bottom-line totals currently come from real API (stats.districtRevenue/myShare); rows must
  reconcile with a backend-provided total so the table doesn't look inconsistent.

## Out of scope
- Adding a real Subscription transaction model to the schema.
- Making the other dashboards (State/Regional/Master) tables live — District only for now.
