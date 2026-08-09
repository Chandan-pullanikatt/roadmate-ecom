# Grill: Quick-commerce pivot — six mobile apps
Date: 2026-08-05

## Intent
RoadMate pivots from a B2B distribution back-office into a **multi-industry quick-commerce
marketplace** (Blinkit/Swiggy model). Six React Native apps get built from scratch against the
existing Express + Prisma + Postgres backend: Customer, Shop/Partner, Delivery, and three
executive apps (Manufacturer, Distributor, Regional Partner). The four legacy Automobile apps
on the never-seen Laravel backend are dead and are not migrated from.

## Constraints
- Legacy Laravel apps are **not working**; no data, users, or order history migrates. Greenfield.
- RoadMate **owns and employs the delivery riders** — coverage is capped by headcount per
  area/shift, not by software.
- Client requires **all industries live at launch** (automobile, groceries, fast food, gym
  membership, pharmacy, …) — not a phased single-category launch.
- Shops are real physical stores with walk-in counters, so app stock and real stock will drift.
- Design source is Figma; no MCP connection exists yet, so designs are currently unreadable.

## Key decisions
- Decision: Shop = fulfilment point. Customer order routes to a nearby shop; a platform rider
  collects from the shop and delivers. Manufacturer/distributor stay purely B2B (they restock
  shops, never touch a consumer order). Reason: only model where the existing partner hierarchy
  and its revenue splits stay meaningful. Alternative rejected: central warehouses / distributor
  ships direct to consumer.
- Decision: Browsing is **hybrid** — customers browse both by shop and by product. Reason: user's
  explicit call. Alternative considered: pure product-first (Blinkit) — rejected as too narrow.
- Decision: **Live per-shop stock**, maintained by shop owners. App orders auto-decrement;
  walk-in/counter sales are manually adjusted by the owner. Alternative rejected: Swiggy-style
  manual accept with no stock counts.
- Decision: **60-second accept timer**, then auto-reroute to next-nearest shop with stock.
  Config value, not a constant — tunable per industry. Reason: a shop not looking at its phone
  must not stall an order indefinitely.
- Decision: Orders are **not permanently bound to one shop**. Order → fulfilment attempts, with
  a state machine (PLACED → ACCEPTED → PICKED → DELIVERED, REASSIGNED a legal transition).
  Reason: silent reroute preserves the customer experience; retrofitting this later is expensive.
- Decision: Stockout policy = **platform absorbs cash loss, shop pays in ranking**. Fulfilment
  rate per shop; below ~85% the shop drops in routing priority and loses peak hours. Three
  consecutive stockouts on a SKU auto-marks it out-of-stock until the owner re-confirms.
  Escalation ladder: warning → demotion → peak suspension → delisting. Reason: cash fines make
  shops switch the app off, and supply is the scarce asset in a young marketplace.
- Decision: Rider dead-run fee paid by the platform; build the shop-deduction field now, set to
  zero, enable in year two.
- Decision: **Platform-owned rider pool**, auto-assigned nearest-available, with manual override
  in the Master dashboard. Alternative rejected: shop-employed riders (serialises fulfilment,
  collapses ETA at peak).
- Decision: Serviceability = **radius per shop (start 5 km)**, serviceable if inside any active
  shop's radius with a rider on shift. Reason: launch a new area by onboarding one shop + one
  rider. Zones/polygons are a scale-stage graduation.
- Decision: Payments = **Razorpay prepaid + COD**, platform collects all money, weekly settlement
  to shops. Reason: money must flow through the platform or the commission/partner-share engine
  that all seven dashboards exist to display has nothing to split. COD implies rider cash-in-hand
  reconciliation as a first-class feature.
- Decision: **React Native + Expo, monorepo with shared UI/API packages.** Reason: the team is
  already all-in on React (7 dashboards, component library, API client); Flutter means learning
  Dart for no gain. Monorepo because the three executive apps are near-identical.
- Decision: Auth = **phone + OTP for customers**; phone + password for shops, executives, riders
  (provisioned/approved accounts, daily logins, OTP friction compounds). Existing JWT + bcrypt
  covers everything but the customer OTP flow, which needs a paid SMS provider (MSG91/Twilio).
- Decision (client's, against recommendation): **all industries launch simultaneously.** Reason
  given: client requirement. Recommendation was groceries-first — the only listed category with
  the order frequency a fixed rider fleet needs. Recorded as a schedule risk owned by the client.
- Decision: `Industry.fulfilmentType` with four values — PICK_AND_DELIVER, COOK_AND_DELIVER,
  VERIFY_AND_DELIVER, NO_DELIVERY — each needing real code in v1 because of the simultaneous
  launch. Gym membership is a redeemable voucher with no rider, no stock, no address; pharmacy
  needs prescription upload + approval before fulfilment; fast food needs prep-time in the ETA.

## Resolution after reviewing the Figma PNGs (designs/*.png)
The pivot framing was wrong. RoadMate is **one platform with two order flows**, not a B2B
system replaced by a B2C one:

    MANUFACTURER → DISTRIBUTOR → SHOP → CUSTOMER
    └──── B2B: TradeOrder ────┘  └─ B2C: ConsumerOrder ─┘

The **shop is the hinge** — it buys B2B and sells B2C from the same stock pool. This resolves
every apparent contradiction in the designs: the Partner app's cart+Payment order list is the
shop *restocking* (correct); the executive apps' shop visits, credit limits and collections are
real B2B distribution (correct); the Delivery app's multi-drop routes with barcode scanning are
B2B freight (correct). The designs cover the B2B half completely and the B2C half partially —
~8–10 screens are missing, not six apps.

- Decision: **B2B stays and gets built**, executive apps ship as designed (credit, collections,
  routes). Confirmed by user.
- Decision: **Two order models, not one.** Existing `Order` → `TradeOrder`; new `ConsumerOrder`
  with its own state machine. Rejected: single table with an `orderType` flag — half-null columns
  and genuinely different lifecycles (days vs 25 minutes, dispatch vs reroute). They meet at
  exactly one place: `ShopInventory` (trade orders increment, consumer orders + walk-ins
  decrement).
- Decision: **Six apps → three codebases.** (1) RoadMate consumer, (2) **RoadMate Business** =
  shop + all three executive roles in one role-driven app, (3) RoadMate Rider. Justification: the
  given bottom navs are near-identical (Home/Shops/Orders/Products/Profile with one tab varying).
  Multiple Play Store listings, if required, come from Expo app variants over one codebase.
- Decision: **Rider app has two modes; build last-mile first.** The designed route/multi-drop mode
  is B2B freight and waits until B2B volume exists.
- Decision: Missing screens get built by Claude in the existing design language, then sent to the
  UI/UX team for polish — rather than blocking on them. Design system: **accent yellow #DEBE10**
  (confirmed by user), green/amber/blue/red status colors, greeting header + stat-tile grid +
  Quick Actions + list, white cards ~12px radius, 4–5 tab bottom nav. First artifact is
  `packages/ui` tokens.
- Decision: Phase 0 ships as **one migration**, not split. Reason: the new models reference each
  other heavily; a half-applied schema is harder to reason about than one honest big step.
  Approved by user 2026-08-06.
- Decision: existing `String` role/status fields are **not** converted to enums. Reason: 7
  dashboards and 6 controllers read those strings; the refactor is wide, risky, and buys nothing
  today. New models use real enums.
- Decision: rider position stored as `lastLat`/`lastLng` on `User`, not a location-history table.
  Reason: 1 ping/10s/rider is millions of rows a week for zero launch-day value.
- Screens to be drawn/built: shop incoming consumer order + 60s timer; shop order lifecycle
  (accepted → packing → ready for pickup); shop stock management; rider consumer job card /
  pickup / deliver / live nav; customer live tracking; pharmacy prescription upload; gym
  membership voucher + redemption; customer cancelled/rerouted state.
- Build order: Phase 0 schema → Phase 1 headless consumer pipeline → Phase 2 Business app (4 of 6
  apps, designs complete) → Phase 3 Rider (last-mile) → Phase 4 Customer app.

## Surfaced assumptions
- The entire existing schema (8 models) is B2B. There is **no** Customer, cart, consumer order,
  delivery assignment, payment, or subscription model — five of six apps have nothing to talk to.
- No `DELIVERY` role exists in the schema.
- No entity carries lat/long. Without coordinates there is no nearest-shop, ETA, serviceability
  check, or rider assignment — this touches nearly every model.
- Riders need shift state + live location pings; "rider available" is on-duty AND not-mid-delivery
  AND in-range, not a boolean field.
- The `Payout` model is a B2B partner-share stub, not a consumer-order settlement ledger.
- The user had not previously distinguished quick commerce from the B2B distribution model the
  whole system was designed around.

## Open questions
- **For the client:** how many shops, how many riders, which district, on launch day. No industry
  standard exists for this; only the client knows. Building phased-launch-shaped until answered.
- Do the three executive apps need three separate Play Store listings, or can they be one
  role-driven app (as the 7 dashboards already are)? Recommendation: one app; awaiting answer.
- Does the client expect a live "in stock" indicator promised to customers?
- Still unresolved from the June 12 grill: whether order commission (the 15% split engine) exists
  at all, and where 15% came from.

## Out of scope
- Migrating any Laravel data, users, or order history.
- Rider batching / multi-pickup runs, surge pricing, zone polygons — scale-stage features.
- Cash penalties on shops in year one (ranking demotion instead).
