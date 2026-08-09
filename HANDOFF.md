# RoadMate — Handoff for a fresh chat
Last updated: 2026-08-09 (the merchandising layer — shop location, product photos,
coupons, banners, collections, auto-apply)

Paste this at the start of a new conversation. Full reasoning lives in
`.grill/quick-commerce-six-apps.md`; the schema proposal is
`server/prisma/schema.proposed.prisma`.

➡️ **`PLAN.md` is the execution plan** — task-level breakdown of Phases 1–4, the cross-cutting
infra nobody scoped (storage, push, SMS, scheduler), and what blocks what. Read it after §6 below.

---

## 1. What RoadMate is

**One platform, two order flows, meeting at the shop.**

```
MANUFACTURER → DISTRIBUTOR → SHOP → CUSTOMER
└──── B2B: TradeOrder ────┘  └ B2C: ConsumerOrder ┘
     (executive apps)            (customer + rider apps)
```

The **shop is the hinge**: it buys B2B and sells B2C from the same stock pool. They share
exactly one thing — `ShopInventory`. Trade orders increment it; consumer orders and walk-in
counter sales decrement it.

This framing was the key unlock of the last session. Earlier confusion came from treating the
B2C quick-commerce side as a *replacement* for the B2B side. It is not — **both are being
built**. The Figma designs cover the B2B half completely and the B2C half only partially.

Multi-industry from day one (client requirement, made against recommendation): automobile,
grocery, restaurant, fashion, electronics, pharmacy, gym membership.

## 2. Current state of the repo

- `client/` — React + Vite. **7 web dashboards** (Master, State, Industry-State, District,
  Regional, Manufacturer, Distributor). Working. Not part of the app build.
- `server/` — Express + Prisma + Postgres. ~40 models across both flows (Phase 0), and the whole
  B2C consumer pipeline behind them (Phase 1). JWT + bcrypt for staff, phone + OTP for customers.
- `apps/business` — **Expo SDK 57 + expo-router. Complete** (Phase 2). Four roles, one codebase:
  the shop in `app/(shop)`, and Distributor / Manufacturer / Regional sharing `app/(exec)`.
- `apps/rider` — **Expo SDK 57 + expo-router. Complete** (Phase 3), `LAST_MILE` only. Seven screens,
  **one** listing serving *both* kinds of rider. Bundles clean. The only thing left out is the
  proof-of-delivery photo/signature, which needs file storage.
- `apps/consumer` — **Expo SDK 57 + expo-router. Complete** (Phase 4), the sixth listing and the
  last codebase. Ten screens: phone+OTP, home, product search, shop, cart, checkout, tracking,
  orders, addresses, profile. Bundles clean. Two things it cannot complete, both for want of a
  purchase: prescription upload (file storage) and any online payment (Razorpay) — which also
  means gym memberships, since those are PREPAID-only.
- `packages/ui`, `packages/api`, `packages/hooks` — shared tokens/primitives/money, the HTTP
  client, and `useResource`. npm workspaces (`apps/*`, `packages/*`); `client/` and `server/` stay
  outside them on purpose.
- `designs/*.png` — six Figma exports, one per app. Read them; they are the spec.
- `.grill/` — four grill logs. `quick-commerce-six-apps.md` is the current one.
- Legacy: 4 Laravel/PHP mobile apps for Automobile. **Dead, not working, nothing migrates.**
  Greenfield. Never ask about migrating that data.

## 3. Decisions already made — do not relitigate

| Area | Decision |
|---|---|
| **Fulfilment** | Customer orders route to a nearby shop; a rider collects from the shop and delivers. Manufacturer/distributor stay purely B2B. |
| **Riders** | ✅ **Resolved 2026-08-07 — independent delivery partners, not platform employees.** The client's answer is "like Swiggy", and it resolves the old contradiction (you cannot charge your own employee a subscription) in three parts, all now built: the ₹2,000/month rider subscription is **deleted**, not relabelled, from `revenueController.js` and both dashboards that showed it — a platform *pays* its delivery partners; per-order pay exists (`src/lib/riderPay.js`, `rider_base_fee` + `rider_per_km_fee` beyond `rider_free_km`), frozen onto the job at delivery exactly as the commission split is; and they are **settled** like shops are (`RiderSettlement`, same weekly `npm run settlement` run). Surge and streak incentives are year two. Dead runs stay platform-paid. ✅ **Rates confirmed on the client call, 2026-08-07: ₹25 base, first 2 km included, ₹8/km beyond.** A 5 km delivery pays ₹49. Recorded by `npm run config:apply`. |
| **Two delivery modes** | ✅ **Foundation built 2026-08-08; the settlement half is still blocked.** A shop either uses **its own delivery boys** or **RoadMate's delivery partners**. The shop is the switch (`User.usesOwnRiders`); a rider's `User.employerShopId` is which side he is on. A shop's own boy delivers **only that shop's orders**, and still signs into RoadMate Rider, goes on shift, and is tracked exactly like ours — the delivery flow is identical, the ownership is not. A shop with its own riders is serviceable in a district where the platform has none, which softens the launch-scale worry. ⚠️ **Three money questions are still out with the client and nothing in settlement may be touched until they land — see §7.8.** |
| **Browsing** | Hybrid — customers browse both by shop and by product. |
| **Stock** | Live per-shop stock maintained by shop owners. App orders auto-decrement; walk-in sales manually adjusted. `User.safetyStockBuffer` (already exists) holds back a % so counter sales don't oversell. |
| **Accept flow** | **60-second** accept timer, then silent auto-reroute to next-nearest shop with stock. Configurable via `PlatformConfig`, never hardcoded. |
| **Order binding** | An order is **not** bound to one shop. `ConsumerOrder` → `FulfilmentAttempt[]`. |
| **Stockout policy** | Platform absorbs cash loss; **shop pays in ranking, not fines**. Fulfilment rate <85% → routing demotion → peak suspension → delisting. 3 consecutive stockouts on a SKU auto-hides it until re-confirmed. |
| **Dead runs** | Platform pays the rider. Shop-deduction field built, set to 0, enabled year 2. A dead run is settled alongside deliveries — it is a trip the rider actually made. |
| **Serviceability** | Radius per shop (default 5 km) + a rider on shift. Not polygons. |
| **Payments** | Razorpay prepaid **+ COD**. Platform collects everything, weekly settlement to shops. COD ≈ 40–60% of early orders → rider cash-in-hand reconciliation is a real feature. |
| **Auth** | Customers: phone + OTP (MSG91, wired 2026-08-07 — real once `MSG91_AUTH_KEY`/`MSG91_TEMPLATE_ID` are set, stubbed until then). Staff (shops/executives/riders): **phone number *or* email address** + password on the existing JWT. ✅ **Resolved 2026-08-07** — the client confirmed "also", not "instead". `POST /api/auth/login` takes an `identifier` and decides which it is (`src/lib/phone.js`); `email` is still accepted so the 7 dashboards are untouched, and no live session was invalidated. `User.phone` now carries a unique index (migration `20260807090000`) — checked against live data first: 34 users, 11 phones, **zero duplicates**. The index only means "one human is one row" because every write normalises first; the two are one mechanism. 17 tests in `tests/staffAuth.test.js`. |
| **Stack** | **React Native + Expo, monorepo** with shared `packages/ui` and `packages/api`. Not Flutter — team is all-in on React. |
| **Enums** | Existing `String` role/status fields stay strings (7 dashboards read them). New models get real enums. |
| **Rider location** | `lastLat`/`lastLng` on `User`. No pings-history table. |

## 4. Six shipped apps → three codebases

✅ **Decided 2026-08-08 by the client, replacing the 2026-08-07 four-listing answer.** Each
business role gets its own app. **Six listings, still three codebases** — which is the whole point
of how `apps/business` was built.

| Shipped app | Serves | Codebase |
|---|---|---|
| **RoadMate** | Customers | `apps/consumer` ✅ built |
| **RoadMate Shop** | Shop owners | `apps/business`, `APP_VARIANT=shop` |
| **RoadMate Manufacturer** | Manufacturers | `apps/business`, `APP_VARIANT=manufacturer` |
| **RoadMate Distributor** | Distributors | `apps/business`, `APP_VARIANT=distributor` |
| **RoadMate Regional** | Regional partners | `apps/business`, `APP_VARIANT=regional` |
| **RoadMate Rider** | Delivery partners **and** shops' own delivery boys | `apps/rider` ✅ built |

**What changed, and what did not.** `RoadMate Partner` is retired — the one listing that had served
all three partner roles is now three listings. Nothing else moved: the four business builds are
Expo app variants of one project (`apps/business/app.config.js`), overriding only name, slug,
scheme and package id, and the three partner roles still share **one** `(exec)` section. Four
listings, one section — those are different things. A build simply ships with one role in
`VARIANT.roles`, so its door admits exactly one of them.

⚠️ **`com.roadmate.partner` is retired, not renamed.** It was never published, so nothing is
stranded. A package id *is* an app to the Play Store, and one app cannot become three.

**Why this was cheap, and worth saying out loud to the client:** the three partner roles never
differed by *screen*. They differ by which endpoints return something, and that has lived in
`apps/business/src/roles.js` as a table since 2026-08-06. So a listing is a row in `app.config.js`
and a role is a row in `roles.js`. Going from two listings to four **touched no screen** — config,
one lookup table, and the scripts. Had the three roles been built as three codebases when they were
first asked for, this reversal would have been a rewrite instead of an afternoon.

**Why not one combined app** (still true, and now the client agrees twice over): the only real
reason to merge would be store discoverability, and it is worth nothing here — partners never
*find* RoadMate in the Play Store. A field executive onboards them, creates the account and tells
them what to install.

Four things this costs, all real, and all worse than the two-listing version:
- **Every release is four Play Store submissions** for this codebase, not one or two.
- **Four sets of icons, screenshots and store copy** — ⚠️ *not done*; all variants currently share
  `assets/icon.png`. Assets only, no code, but it is now four times the asset work and it is the
  thing standing between here and a store submission. ⚠️ **Platform-wide it is six sets**, since
  `apps/rider` and `apps/consumer` ship a copy of the same placeholder.
- **Being told the wrong app is likelier, not less likely** — there are now four business apps for
  a field executive to confuse. `src/variant.js` + the door is what absorbs it: `APP_FOR_ROLE` is
  one table mapping a role to the app it should have installed, so a distributor who installs
  RoadMate Manufacturer is told, by name, which one to get — never signed in to empty tabs.
- **Four builds to keep bundling.** All four export clean today; a change that breaks one breaks
  all four, so check them together.

The four business roles have near-identical bottom navs in the designs
(`Home/Shops/Orders/Products/Profile`, one tab varying) — which is exactly how it was built:
`apps/business/src/roles.js` is that "one tab varying", as a table. A fifth role is a row in that
file; a fifth *listing* is a row in `app.config.js` plus a row in `APP_FOR_ROLE`. Neither is a new
codebase, and this reversal is the proof.

**Field executives (`EXECUTIVE` / `executiveType: 'LISTING'`) — the staff who onboard shops — have
no app and no web dashboard.** They fall through the door to "your role works from the web
dashboard", and no such dashboard exists among the seven. Not urgent, nothing is blocked on it, but
it is a real gap and not a re-split: it would be new screens. ⚠️ Note that "six apps" does **not**
include them — the six are customers, shops, the three partner roles and delivery partners.

## 5. Design system

- **Accent yellow: `#DEBE10`** (confirmed by user) — primary buttons, active tab, selected
  chips, quantity steppers
- **Status:** green = Delivered/Active/Healthy · amber = Packed/Pending · blue =
  Dispatched/route cards · red = Cancelled/Log out
- **Screen pattern:** greeting header (avatar + bell) → stat-tile grid (2×2 / 3×2) → "Quick
  Actions" icon row → list section
- **Cards:** white, ~12px radius, soft shadow, generous padding
- **Lists:** thumbnail left · title + meta stacked · status pill right
- **Bottom nav:** 4–5 tabs, icon over label, accent when active
- **Money:** bold, right-aligned. SKU in small grey caps above product name.
- Known design bug: executive screens show `$` (`$14.5k`, `$38.25/unit`), customer screens show
  `₹`. Everything is ₹.

**Screens missing from the designs** — build them in the above language:
~~shop incoming-order + 60s timer~~ · ~~shop order lifecycle (accepted → packing → ready)~~ ·
~~shop stock management~~ · ~~gym-membership voucher redemption (shop half)~~ · ~~executive order
detail (the seller's status ladder)~~ · ~~executive network / approvals~~ **← these six are built
*and polished in-house* (2026-08-07). Not going out to the UI/UX team.** · ~~rider consumer job card /
pickup / deliver~~ **← built 2026-08-08 in the same language; live nav is deliberately a hand-off to
Google Maps rather than an in-app map, see §6 Phase 3** · ~~customer live tracking~~ · ~~customer
voucher/QR~~ · ~~customer cancelled/rerouted~~ **← built 2026-08-08 with Phase 4. The voucher screen
is the *code*, not a QR image: the shop redeems by looking a code up and has no scanner.** ·
pharmacy prescription upload **← the one customer screen still unbuilt, and the only one blocked on
a purchase rather than on design.**

**The polish pass (2026-08-07)** added six primitives to `packages/ui`, because the gap was
never per-screen styling — it was that the designs use patterns the package did not have, so
each screen had hand-rolled its own:

| Primitive | What it fixes |
|---|---|
| `SearchField` | the designed search box (magnifier + clear). Three screens had each hand-rolled the same bare `TextInput`, none with the icon |
| `OrderCard` | the design's actual order row — money bold on its own line with `Details ›` opposite. `ListRow` stacked pill+money in one narrow column, putting the figure people scan for in the smallest type on the row |
| `GroupedCard` / `GroupedRow` | the Profile screen's one-card-many-rules list with chevrons. Separate cards read as separate things; "Buyer / Seller / Industry" is one thing |
| `Banner` + `connectionMessage` | ⚠️ **the real bug this pass found.** `useResource` keeps the last good data when a poll fails, and *no screen rendered `error` at all* — so a shop could watch a countdown that had silently stopped being connected to anything |
| `Skeleton*` | every list rendered nothing on first paint, so "loading" and "genuinely empty" looked identical |
| `StickyFooter` | the one forward action was below the fold on a long order. Late taps burn the customer's promised ETA |

Three real defects fixed in passing, all found by reading the screens closely rather than by
looking at them: the shop order timeline's connectors used `left:'50%'; right:'-50%'`, which is
not layout React Native honours; the network screen's busy flag was keyed on partner id alone, so
rejecting a partner spun that row's **Approve** button; and the voucher screen's post-failure
refresh re-ran the *search box* rather than re-checking the voucher on screen.

The tokens are code: `packages/ui/src/tokens.js`. Note `colors.onAccent` — #DEBE10 is a mid-tone
yellow, so text on it is always ink, never white.

## 6. Build order

- **Phase 0 — schema.** ✅ **DONE** (2026-08-06). Merged into `schema.prisma` with all relations
  wired; `Order`→`TradeOrder`, `OrderItem`→`TradeOrderItem`, `Payout.orderId`→`tradeOrderId`
  renamed across the 4 controllers + `seed.js`. Applied as one migration
  `20260806000000_phase0_two_flow_platform` — hand-edited to `ALTER TABLE … RENAME` instead of
  Prisma's default drop/create, so the 28 orders / 30 items / 59 payouts survived. No drift.
  `schema.proposed.prisma` is now superseded; keep only as the reasoning record.
  - `getPayouts` still returns the key `order` (mapped from `tradeOrder`) so the dashboards
    keep working.
  - `PlatformConfig` uses `@@unique([key, industryId])` rather than the proposal's `key @unique`,
    because `industryId` is a per-industry override. Postgres treats NULLs as distinct, so
    **nothing stops two rows with the same key and a null industryId** — enforce "one global row
    per key" in the config service, or add a partial unique index later.
- **Pre-work (`PLAN.md` §1).** ✅ **DONE** (2026-08-06). Migration
  `20260806045649_phase1_prework_decimal_money_and_push_tokens`, all in-place `ALTER`s, B2B data
  intact, no drift. Three things every later phase must respect:
  - **B2C money is `Decimal`, not `Float`** (28 columns). Prisma returns `Decimal` objects — use
    `.plus()` / `.toString()`, **never `+`**, and serialize with `.toFixed(2)` at the API edge.
    B2B stays `Float` on purpose; a test enforces it.
  - **`DeviceToken` model** (not a field): unique `token` so registration is an `upsert`, and a
    `DeviceToken_owner_xor` CHECK so a device belongs to either a staff `User` or a `Customer`.
  - **Tests exist.** `cd server && npm test` — `node:test` + `supertest` against a real
    `roadmate_test` Postgres. Write Phase 1 test-first; that was the whole point.

  Also, because the tests forced it: one shared `PrismaClient` in `src/lib/prisma.js` (there were
  8), and `src/app.js` (exports the app) split from `src/index.js` (only `listen`s). **New routes
  go in `app.js`.** Public `GET /api/health` added.
- **Phase 1 — consumer order pipeline, headless.** Serviceability → shop selection → 60s accept
  → reroute → rider assign → deliver → settle. Tested via API before any screen exists.
  - **1.1 customer auth** ✅ **DONE** (2026-08-06). `POST /api/customer/auth/otp/request` +
    `/verify`, `GET /api/customer/me`, and `protectCustomer`. 33 tests green. Three things later
    phases must respect:
    - **Two auth guards, told apart by JWT audience.** Customer tokens carry
      `aud: roadmate-customer` (`src/lib/customerToken.js`) and resolve `Customer`; staff tokens
      have no `aud` and resolve `User`. `protect` now rejects the customer audience, and
      `protectCustomer` rejects anything else. Neither is a branch of the other. Live dashboard
      sessions were not invalidated.
    - **Customer routes mount above `app.use('/api', protect)`** in `app.js` — that line applies
      the staff guard to everything registered after it. Put every new `/api/customer/*` route in
      the block above it.
    - **SMS is still a stub.** `sendOtpSms` logs; the OTP comes back in the response body only
      when `NODE_ENV !== 'production'` (a test pins that). Real delivery stays blocked on the
      client paying for MSG91/Twilio — it does not block any further backend work.
  - **1.2 serviceability + ranking, 1.3 catalog + cart, 1.4 placement** ✅ **DONE** (2026-08-06).
    **95 tests green.** Four things later phases must respect:
    - **`rankCandidateShops()` in `src/lib/shopRanking.js` is the one candidate list.** The
      serviceability endpoint, product search, placement's serviceability re-check and (next)
      the reroute sweeper all call it. It takes `excludeShopIds`, `limit` and `requireStock`
      precisely so 1.5 does not need a second ranking. Order is `routingPriority` DESC →
      distance ASC → `fulfilmentRate` DESC → id.
    - **Placement reserves; it never decrements.** `ShopInventory.reserved` goes up inside the
      transaction via a raw `UPDATE ... WHERE (quantity - reserved) >= n`. Prisma's `updateMany`
      cannot express that predicate — this is deliberately `$executeRaw`, and turning it back
      into read-then-write is how the platform starts selling stock it does not have.
      `quantity` drops at delivery (1.8).
    - **An order is placed with `shopId = null`.** The cart's shop is only the first routing
      candidate (returned as `firstCandidateShop`). Binding happens on accept, per §3's reroute
      decision. Nothing downstream may assume placement picked a shop.
    - **Nothing is hardcoded that belongs in `PlatformConfig`.** Read it through
      `getConfigNumber(key, industryId)` in `src/lib/platformConfig.js` (per-industry override →
      global → documented default). `tax_percent` and `delivery_fee` default to **0** because
      the client has given neither figure; see the open questions below.
  - **1.5 routing + sweeper, 1.6 shop response, 1.7 delivery** ✅ **DONE** (2026-08-06).
    **147 tests green.** The whole pipeline now runs headless, end to end: OTP login →
    serviceability → cart → placement → offered to shop A → timed out by the sweeper → rerouted to
    shop B → accepted → packed → assigned to a rider → picked up → delivered, with stock correct
    throughout (`tests/delivery.test.js`'s last test is that exact walk). Five things later phases
    must respect:
    - **One reroute implementation.** `advanceOrder()` in `src/lib/routing.js` is the only place an
      offer closes and the next shop is tried — the sweeper's timeout, a shop's reject, and a
      shop's stockout-after-accept all call it. Do not write a second path for any new way an offer
      might end.
    - **The claim is the lock.** Every state change that matters is a conditional `updateMany`
      whose WHERE clause re-asserts the reason for acting (`status = OFFERED AND expiresAt >= now`
      for an accept; `riderId = null AND status = UNASSIGNED` for a rider claim). A count of 0 means
      someone else won — stop, don't retry, don't "recover". This is the same discipline as §1.4's
      stock reservation and it is why two sweepers, a sweeper racing an accept, and two orders
      racing one rider are all tested and all safe.
    - **A reservation lives on one shop's shelf.** Every reroute — sweeper, reject, or stockout —
      releases the old shop's `reserved` and takes it on the new one inside one transaction, via
      the same conditional `UPDATE ... WHERE (quantity - reserved) >= needed` §1.4 uses. `quantity`
      still only drops once, in `decrementShelfOnDelivery()` — the true end of "reserve, never
      decrement".
    - **`fulfilmentRate` is the only automatic penalty.** It is recomputed as `accepted / responded`
      after every attempt closes. `routingPriority` is never touched by this code — it is the
      operator's manual demotion lever, and an automated recompute silently overwriting a human
      decision is exactly the bug HANDOFF §3 ("a shop pays in ranking, not in fines") is designed
      to avoid.
    - **The sweeper is `npm run sweeper`, a second process.** It must run alongside the API in every
      environment — nothing else enforces the 60-second window. It self-heals (`recoverStalledOrders`)
      an order that got stuck `ROUTING` with no live offer, which is the one way a process crash
      could otherwise strand a reservation forever.
    - Fixed in passing: `getConfig()`'s per-industry override was silently losing to the global row,
      because Postgres sorts `DESC` as NULLS FIRST. Precedence is now picked in JS.
  - **1.8 money** ✅ **DONE** (2026-08-06). **168 tests green.** Razorpay order + webhook, the
    commission split, COD cash-in-hand, refunds and the weekly settlement run. Five things later
    phases must respect:
    - **The webhook signature is the authentication.** `POST /api/payments/razorpay/webhook` is
      public and behind no middleware; `verifyWebhookSignature()` HMACs `req.rawBody` (captured by
      `express.json({ verify })` in `app.js` — a re-serialised body will not match a real signature)
      and fails **closed** without a secret. The client's own checkout callback is never trusted to
      mark anything paid, and marking PAID is a conditional `updateMany` on `status = PENDING`, so
      only the caller that wins that claim calls `beginRouting()`. A Razorpay retry is a no-op.
    - **The commission split is frozen at delivery**, never recomputed. `applyCommissionSplit()`
      (`src/lib/settlement.js`) reads `commission_percent` from `PlatformConfig` inside the delivery
      transaction and writes `platformCommission`/`shopPayable` onto the order; settlement then
      *reads* those columns. Changing the config later cannot rewrite a delivered order — which is
      what makes the still-unconfirmed default 15 safe to ship behind (it is on no shop-facing screen).
    - **Money is recorded before it is moved.** `closePaymentAsRefundable()` writes `REFUNDED` +
      `refundAmount`/`refundedAt` inside the cancelling transaction and fires the gateway refund
      **without awaiting it** — an unreachable Razorpay must never hold that transaction's locks.
      The `Payment` row is the ledger; the API call is best-effort.
    - **COD cash has a full loop now.** `GET`/`POST /api/rider/remittance` and
      `GET /api/finance/cod-outstanding` (MASTER-only). Remitting re-asserts `cashRemittedAt: null`
      in its `updateMany`, the same claim discipline as everything else here.
    - **`npm run settlement` is a one-shot, not a daemon** — unlike the sweeper. Point cron at it
      weekly. It is re-runnable: an order already on a `SettlementLine`, or a shop+period already
      settled, is skipped rather than paid twice.
    - `src/lib/razorpay.js` **stubs out** when `RAZORPAY_KEY_ID`/`_SECRET` are absent, exactly like
      `sendOtpSms`. No test makes a network call; three env vars switch it on with no code change.
  - **1.9 fulfilment types** ✅ **DONE** (2026-08-06). **190 tests green — Phase 1 is complete.**
    Migration `20260806120000_phase1_9_fulfilment_type_branches` (two in-place `ALTER`s:
    `ConsumerOrder.addressId` nullable, `User.prepTimeMin` added). Four things later phases must respect:
    - **`Industry.fulfilmentType` is the only switch, and it is read in one place.**
      `src/lib/fulfilment.js` owns every predicate (`isDelivered`, `isVoucherOnly`,
      `needsPrescription`, `needsPrepTime`, `isSupported`). No controller compares against an enum
      value directly — a fifth industry type is a change to that file, not a grep across the codebase.
    - **Gates are additive, and every caller re-checks all of them.** `isRoutable()` is now
      `isPayableNow()` *and* `prescriptionCleared()`, and `beginRouting()` is the single entry point
      for "something cleared, proceed". §1.8's webhook and a pharmacist's approval both call it, and
      the second one to clear starts the accept window — neither knows about the other. Anything that
      gates an order in future adds a term to `isRoutable`, not a new hook.
      ⚠️ `prescriptionCleared()` **throws** if `industry` was not included on the order. That is
      deliberate: the failure it replaces is silent (an unverified pharmacy order reaching a shop).
      Any query feeding a gate check must include `industry` and `prescriptions` — use the exported
      `orderInclude` from `routing.js`.
    - **NO_DELIVERY is a different shape and stays out of the routing engine.** It binds `shopId` at
      placement, opens **no `FulfilmentAttempt`**, reserves nothing, has no address and no
      `DeliveryJob`, and lands on `DELIVERED` when the voucher is issued — because DELIVERED is what
      this codebase means by "the sale is final", which is what freezes the split and what settlement
      pays out from. It is also **PREPAID-only**: cash at the gym's own counter is money the platform
      never holds but would still be booking commission on.
    - **The ETA is a number, not a state machine.** `promisedEtaMin` = base + travel + prep, with prep
      non-zero only for COOK_AND_DELIVER, and it is **remade at accept** — placement's estimate was
      about the first candidate, and a reroute may have left that shop behind.
- **Phase 2 — RoadMate Business app.** 4 of 6 apps, designs already complete. Shop role first.
  - **Monorepo + `packages/ui` + `packages/api` + the shop role** ✅ **DONE** (2026-08-06).
    npm workspaces + Expo SDK 57 + expo-router; `apps/business` bundles clean
    (`npx expo export --platform android`). Eight screens: sign-in, home, offers + 60s countdown,
    order lifecycle, stock, restock (B2B), vouchers, profile. **213 server tests green** (23 new)
    plus 10 in `packages/ui`. Five things later phases must respect:
    - **One new backend area: the shelf from the shop's side.** `shopInventoryController.js` —
      `GET`/`POST /api/shop/inventory`, `PATCH /api/shop/inventory/:id`, `.../confirm`, and
      `GET`/`PATCH /api/shop/storefront`. It did not exist: every previous reader of `ShopInventory`
      was customer-facing and read-only, so "live per-shop stock maintained by shop owners" (§3) had
      no way to be maintained. **The shop owns `quantity`, the pipeline owns `reserved`** — a count
      correction below `reserved` is refused by a conditional `updateMany`, because a reservation can
      land between the read and the write. And **`/confirm` is §3's missing half**: it is the only
      thing that clears `consecutiveStockouts`, so an auto-hidden SKU comes back through a recount
      and not through a toggle (`PATCH {isAvailable:true}` on one returns `NEEDS_CONFIRMATION`).
    - **Money never becomes a float on the client.** `packages/ui/src/money.js` formats fixed-2
      strings by string manipulation and adds them in integer paise via `BigInt`. `mulMoney` refuses
      a fractional multiplier on purpose — percentages and commissions are the server's arithmetic,
      and a client recomputation would disagree with the ledger. `formatAmount` covers the B2B
      `Float`s, which stay floats deliberately. 10 tests pin all of it.
    - **A 409 is an outcome, not an error.** `ApiError` carries the backend's `reason`, and the
      offers screen renders `OFFER_CLOSED` as "this order moved on" and refreshes. It never retries:
      accept is a claim, and losing it means another shop already has the order.
    - **The countdown trusts the duration, not the clock.** It runs off `secondsRemaining` and
      anchors on elapsed wall time rather than decrementing, so a backgrounded app does not drift.
      At zero it re-asks the server instead of deciding the offer is dead — the sweeper is the
      authority, not the phone.
    - **`commission_percent` is on no screen**, per §7.2. Settled amounts are real and could be shown
      one day; a live percentage that still defaults to the undocumented 15 cannot.
  - **Push (Expo Push)** ✅ **DONE** (2026-08-06). `POST /api/devices` + `/api/customer/devices`
    (one `registerDevice`, setting exactly one of `userId`/`customerId` so the `DeviceToken_owner_xor`
    CHECK holds), `src/lib/push.js` (stubs out under `NODE_ENV=test`; flips `isActive` false on
    Expo's `DeviceNotRegistered`), and **one call site** — `notifyShopOffered()` in `routing.js`,
    called from the three places an offer becomes visible to a shop. 12 tests, no network calls.
  - **The three executive roles** ✅ **DONE** (2026-08-06) — **Phase 2 is complete.** Six screens in
    `apps/business/app/(exec)` and **no new backend**: `getOverview` already branches per role, and
    the partner / order / product controllers are the same endpoints the 7 dashboards call. Four
    things later phases must respect:
    - **One `(exec)` section for three roles, driven by a table.** `apps/business/src/roles.js` holds
      each role's stat tiles (because `getOverview` returns *different keys per role*), which tabs it
      gets, and its labels. A tab is hidden when the role's endpoint returns nothing — a Manufacturer
      onboards nobody, a Regional partner sells nothing. A fourth role is a row in that file.
    - **`updateOrderStatus` is not idempotent, and the app is what protects it.** `Approved` and
      `Dispatched` each decrement `Product.stockLevel` with no guard; `Delivered` writes the payout
      splits. So the order detail offers exactly **one** next rung of a fixed ladder, never a status
      picker, always behind a confirmation naming the consequence. This is the inverse of the B2C
      rule — there the server re-asserts the reason for acting; this endpoint predates that and
      cannot, so the UI must not offer the tap. Hardening it later means a conditional `updateMany`
      on the current status.
    - **`shopApi` and `executiveApi` are merged into one client**, so the trade methods are named
      `listTradeOrders` / `setTradeOrderStatus` — `listOrders` / `setOrderStatus` already mean the
      *consumer* inbox. Two order flows meet in this app; a name collision would have silently
      swapped a shop's offers for its purchase history.
    - **Still no commission percentage on any screen.** Regional's `myShare` and its settled `Payout`
      rows are shown because those are figures the server computed; the undocumented 15 is not.
  - **Polish + phone sign-in + MSG91** ✅ **DONE** (2026-08-07). **255 server tests green** (30
    new: `tests/staffAuth.test.js` 17, `tests/execApp.test.js` 13) plus 10 in `packages/ui`.
    `apps/business` bundles clean. Four things later phases must respect:
    - **The six undesigned screens are polished and are not going out.** Six new primitives in
      `packages/ui` (§5) — the gap was missing shared patterns, not per-screen styling.
    - **`tests/execApp.test.js` is the app↔API contract.** Nobody had ever driven the `(exec)`
      screens against a running API; bundling proves the imports resolve and nothing about whether
      `order.items[0].product.sku` exists. It asserts the exact fields the screens dereference,
      per role, and it found **no** shape mismatches — the screens were right. It is what will
      fail if a response is reshaped later. It also pins the non-idempotent
      `updateOrderStatus` *as a fact*, so that if the endpoint is ever hardened the test fails and
      tells the next person the one-rung UI guard can be relaxed.
    - **`src/lib/phone.js` is the one normaliser**, for `Customer` and `User` alike. Two
      normalisers is how "+91 98765 00011" and "9876500011" become two rows for one human.
    - **`src/lib/sms.js` (MSG91) stubs out exactly like `razorpay.js`.** No caller, route or
      schema changes when credentials land — two env vars. It never throws (the hashed token is
      already written by then) and it never returns the code to anyone. Production now answers
      **502 `SMS_DELIVERY_FAILED`** rather than claiming "OTP sent" for a code nobody will get,
      which would otherwise leave the customer rate-limited for ten minutes over our outage.
  - **Rider pay · confirmed numbers · variant validity · B2B config · Master settings screen**
    ✅ **DONE** (2026-08-07). **299 server tests green** (44 new: `riderPay` 14, `masterConfig` 13,
    `b2bConfig` 9, `platformConfigApply` 6, plus 2 in `fulfilmentTypes`), 10 in `packages/ui`,
    `apps/business` bundles clean, `client` builds. Two migrations, both additive:
    `20260807140000_rider_earnings_and_settlement` (two new tables) and
    `20260807141000_variant_validity_days` (one nullable column). No drift, nothing altered.
    Five things later phases must respect:
    - **A rider is paid, and the pay is frozen at delivery.** `src/lib/riderPay.js` is the only
      place a delivery becomes money for a rider: base + per-km beyond a free radius, all three
      from `PlatformConfig`, computed once in `deliver()`'s transaction and written to
      `DeliveryJob.riderEarning`. This is the same discipline as `applyCommissionSplit()` and for
      the same reason — raising the rate next month must not reprice a trip somebody already made.
      Settlement *reads* that column; it never recomputes it.
    - **`RiderSettlement` is separate from `Settlement`, deliberately.** A shop settlement nets
      commission off gross sales it collected; a rider settlement is a sum of fees the platform
      owes outright. One model doing both would be half-null in either direction. Both run from
      the same weekly `npm run settlement`, and both are re-runnable by the same mechanism: a job
      already on a line is never paid twice.
    - **`ProductVariant.validityDays` demoted `voucher_validity_days` to a fallback.** The shop
      sets price *and* duration (client answer): price was already per-variant on
      `ShopInventory.sellingPrice`, duration had nowhere to live, so the platform's 30-day default
      was deciding a commercial term on the gym's behalf. One order gets one voucher, so a
      multi-line order takes the **longest** validity on it.
    - **Nothing in the B2B flow is a constant any more.** `totalAmount * 0.15` and the five tier
      shares are `b2b_commission_percent` and `tier_share_*`; the subscription fees are
      `subscription_fee_*`. Every figure is unchanged — only who may change it next. ⚠️
      `b2b_commission_percent` is **not** the B2C `commission_percent`; a test pins that moving
      one does not move the other.
    - **Unset is not zero, and it survives to the screen.** `subscription_fee_manufacturer` has no
      row *and no default*, so `getConfigNumber` returns null, the API sends
      `feeConfigured: false`, and the District dashboard renders "—". A 0 would render as "free",
      which is a different claim. Blanking a field on the Master screen *clears* the row; it does
      not write a 0.
  - **Shop-owned delivery boys — the foundation** ✅ **DONE** (2026-08-08). **321 server tests
    green** (19 new in `tests/shopOwnRiders.test.js`), 10 in `packages/ui`, both app variants
    bundle. One additive migration, `20260808090000_shop_owned_delivery_riders` — two columns and
    an index, nothing altered, nothing backfilled. Five things later phases must respect:
    - **`employerShopId` partitions every rider, and the partition is enforced in BOTH
      directions.** A shop with `usesOwnRiders` draws only from riders it employs; the platform
      pool is only riders **nobody** employs. The second half is the sharp edge: a shop's boy left
      in the platform pool gets sent to collect a rival shop's order, and nothing else in the
      system would notice. It is applied in all three places that ask "who can collect this" —
      `freeRidersNear()`, `hasRiderCoverage()` (⚠️ that one was the bug the tests caught: platform
      coverage was counting somebody else's employee) and the assignment claim, which re-asserts
      employment under the rider lock so a hire landing mid-flight cannot slip through. The
      exclusion does **not** depend on the employer having switched the mode on — a shop can hire
      before it flips the switch, and he is still not RoadMate's to dispatch.
    - **Serviceability is now two questions, not one.** `filterDeliverableShops()` in
      `shopRanking.js` is the one place they are asked together: a platform-pool shop needs a
      RoadMate rider on shift near the **customer**, a self-delivering shop needs one of its own on
      shift near the **shop**. Both `getServiceable` and placement route through it, and it filters
      `candidates` rather than just the check — a shop nobody can collect from must not be a
      reroute target either.
    - **RoadMate pays a shop's own boy nothing, and settles him nothing.** `computeRiderEarning()`
      returns zero for a rider with an `employerShopId` (dead runs too), `runRiderSettlement()`
      skips him, and `GET /api/rider/earnings` answers **403 `EMPLOYED_BY_SHOP`** rather than a
      screen of zeroes — "RoadMate owes you nothing this week" is a different claim from "RoadMate
      is not who pays you". `GET /api/auth/me` now carries `employerShopId` + `employerShop.name`,
      which is what hides the tab. ⚠️ This is the pay decision, which was already stated; it is
      **not** one of §7.8's three blocked ones.
    - **The shop hires its own staff, and "remove" is deactivation.** `shopRiderController.js` —
      `GET`/`POST /api/shop/riders`, `PATCH /api/shop/riders/:riderId`. A field executive onboards
      shops and does not know a shop's employees. Clearing `employerShopId` is deliberately **not**
      offered: it would move an ex-employee into the platform pool, which is the exact failure the
      partition exists to prevent, so releasing somebody sets `isActive: false` (refused while they
      are carrying a job, same rule as going off shift mid-delivery).
    - **No fallback was invented.** A self-delivering shop whose boys are all busy or off shift
      queues the job `UNASSIGNED` — exactly what already happens when no rider is on shift at all.
      Whether a platform rider backs it up is §7.8c and a test pins that nobody does it today.
- **Phase 3 — Rider app.** ✅ **DONE** (2026-08-08), `LAST_MILE` only; the designed multi-drop
  `TRADE_ROUTE` mode still waits for B2B volume. **334 server tests green** (13 new in
  `tests/riderApp.test.js`), 10 in `packages/ui`, `apps/rider` and all four business variants
  bundle clean. `apps/rider` is the third codebase and the fifth of six listings. **No migration** —
  the whole rider backend already existed from §1.7/§1.8 and 2026-08-08's foundation work; the only
  server change was additive fields on the session payload. Six things later phases must respect:
  - **One listing, two kinds of rider, and the difference is three components wide.** A RoadMate
    delivery partner and a shop's own delivery boy install the same app and walk an identical
    flow. `employerShopId` on `/api/auth/me` drives all of it: the **Earnings tab is not rendered**
    for a shop's employee, Profile names who *does* pay him, and Home swaps "Earned today" for
    "Deliveries in hand". Nothing else in the app asks who employs the rider, and nothing else
    should — the backend already partitions the pool in three places, so **any job that reaches
    the app is one that rider is allowed to have**. A client-side check would be a second, weaker
    copy of a database rule.
  - **The ladder is two rungs, and the enum lies about that.** `DeliveryJobStatus` carries
    `EN_ROUTE_PICKUP` and `AT_PICKUP` and **no endpoint sets either** — `pickUp()` accepts all
    three pre-collection states and moves straight to `EN_ROUTE_DROP`. `apps/rider/src/job.js`
    draws the ladder that exists (`ASSIGNED → EN_ROUTE_DROP → DELIVERED`, with `FAILED` off the
    side for a dead run). A button whose endpoint does not exist fails in a rider's hand at a shop
    counter, which is the inverse of the `(exec)` rule: there the UI must not offer a tap the
    server cannot survive; here it must not offer one the server does not have.
  - **The session payload is now one shape, and it grew two load-bearing fields.**
    `login` and `getMe` both go through `publicUser()` in `authController.js` — a field on one and
    not the other is a screen that works until the app is reopened, and a test pins the two key
    sets equal. The additions: **`executiveType`**, because `EXECUTIVE` is two different jobs and
    a `LISTING` field executive signed in to a rider's empty job list is exactly §4's known gap
    made worse; and **`isOnShift`**, because a cold start must render the toggle as it really is
    rather than assuming "off" and inviting a tap that ends a working shift. Additive only — the
    seven dashboards ignore extra keys and no live session was invalidated.
  - **The shift is server-owned and never optimistic.** Going off shift while carrying a job is a
    409, and `session.js` only ever sets the local flag from a response that succeeded. Showing
    "off shift" to a rider the platform is still assigning orders to is the worst lie this app
    could tell. Coming *on* shift sweeps up jobs that reached READY with nobody to take them, so
    the response's `jobsAssigned` is surfaced as an alert — silently landing three deliveries in a
    list nobody is looking at is how the first one gets missed.
  - **Location is a precondition, not telemetry, and it runs only while on shift.**
    `freeRidersNear()` and `hasRiderCoverage()` read `lastLat`/`lastLng`, so a rider whose position
    goes stale stops being assignable *and* can take the shops around them out of serviceability
    with them. Foreground permission only (nothing in Phase 3 needs a position while the app is
    closed), 20-second interval, plus a report on returning from the background — and a failed
    report is **dropped, never queued**, because each one overwrites the last and there is no
    pings-history table by design.
  - **Navigation is a hand-off to Google Maps, not an in-app map.** A universal maps URL built from
    the job's **coordinates**, never the typed address — the platform routed the order by lat/lng
    and a text search can land a rider on a similarly-named road across the city. An in-app map
    would be a second routing engine, a key to buy, and a worse turn-by-turn than the one already
    on the phone.
  - ⛔ **The proof-of-delivery photo and signature are the one thing left out**, and they are the
    only part of this phase that was ever blocked on file storage. `deliver()` takes `photoUrl` /
    `signatureUrl` and `riderApi` passes them through, so when Cloudinary lands the app uploads
    first and **no endpoint changes**. Deliberately **no disabled camera button** — an affordance
    that cannot work is worse than one that is absent. The OTP-and-note half is complete and
    ships, and the OTP is not a formality: a wrong code is a 422, the order does not move, and
    there is no override in the app because there is none in the API.
- **Phase 4 — Customer app.** ✅ **DONE** (2026-08-08). **352 server tests green** (18 new in
  `tests/consumerApp.test.js`), 10 in `packages/ui`, `apps/consumer`, `apps/rider` and all four
  business variants bundle clean. `apps/consumer` is the third codebase and the sixth of six
  listings — **every app the platform ships now exists as code.** **No migration and no new
  endpoint**: the whole consumer pipeline was built headless in Phase 1 precisely so this phase
  would be screens over an API that already answered. Six things later work must respect:
  - **The order is not the shop's until it accepts, and the app renders that.** `placeOrder`
    returns `order.shop === null` plus a separate `firstCandidateShop` — the shop whose shelf holds
    the reservation, not the seller. Every screen that names a shop reads `order.shop` and says
    "finding you a shop" while it is null. Treating `firstCandidateShop` as the seller would name
    the wrong shop on exactly the orders that time out, which is the fraction nobody can predict.
    The reroute trail is `attempts`, and the app says *that we kept trying* without ever naming a
    shop that declined — a timeout is not a reputation claim the platform gets to make.
  - **The bill is the server's arithmetic, and checkout does not attempt it.** Tax is a
    per-industry `PlatformConfig` row, the delivery fee is another, a coupon is resolved against
    limits the client cannot see, and all of it is frozen onto the order at placement. So checkout
    shows the cart's **subtotal** and says the rest is added when the order is placed; the tracking
    screen shows the real bill a second later. An "estimated total" would be a second answer to a
    question that already has one, and the two would disagree the first time the client edited a
    rate from the Master settings screen.
  - **Carts are plural and never merge.** One cart per shop is a schema rule
    (`@@unique([customerId, shopId])`) and the Cart tab exists to make it visible: two shops is two
    deliveries, two accept windows, two riders. Nothing in a cart is reserved — reservation happens
    once, at placement — so a 409 at checkout names the product that sold out and is not a retry.
  - **`useResource` is a package now, as promised.** Phase 3 left a note that two copies were the
    cheaper trade and a third would flip it. This was the third, so `packages/hooks` exists and
    both older apps import from it; the two files were byte-identical apart from their comments.
    ⚠️ One file, three apps: a change here breaks all three, so check all six builds bundle.
  - **What cannot be completed is stated on screen, never disabled.** Two flows are blocked on
    purchases the client has not made. **Prescription upload** needs file storage, so there is no
    camera button — checkout says a pharmacy order will wait at the pharmacist's gate, and the
    order screen names that gate. **Online payment** needs Razorpay, so with no
    `EXPO_PUBLIC_RAZORPAY_KEY_ID` the app offers cash on delivery only and says why — and because
    `NO_DELIVERY` is PREPAID-only on the server, **gym memberships cannot be bought at all today**,
    which the home screen says before a cart is filled. This is the Rider app's disabled-camera
    rule applied twice: an affordance that cannot work is worse than one that is absent.
  - **Tracking polls every 10 seconds and stops when the order settles.** Sockets are the upgrade
    path *if this visibly fails* (PLAN §5), deliberately not before. A delivered or cancelled order
    will never change again, so the screen stops asking rather than draining a battery on a phone
    left face-up.

- **File storage — the Cloudinary seam, and the two flows that were waiting on it**
  ✅ **DONE** (2026-08-09). **366 server tests green** (14 new: `tests/uploads.test.js` 9, plus 2
  in `riderApp`, 2 in `consumerApp`, 1 split in `catalogCart`), 10 in `packages/ui`, all six builds
  bundle, `client` builds. **No migration.** Both endpoints are unchanged — `deliver()` has taken
  `photoUrl`/`signatureUrl` since §1.7 and the prescription endpoint has taken a URL since §1.9,
  which is the whole reason four phases could ship around this. Six things later work must respect:
  - **The phone gets a signature, never the secret.** `src/lib/cloudinary.js` stubs out without
    credentials exactly like `razorpay.js` and `sms.js`. `POST /api/rider/uploads/signature` and
    `POST /api/customer/uploads/signature` issue a one-shot authorisation for **one kind** of
    upload; the app then posts the bytes **straight to Cloudinary**, which is also why a 5 MB photo
    on 3G never holds an Express worker open. ⚠️ `CLOUDINARY_API_SECRET` must never become an
    `EXPO_PUBLIC_*` variable — those are compiled into the APK and readable from it, and that key
    can delete every asset in the client's account.
  - **`UPLOAD_KINDS` is a closed table, and the audience comes from the route.** A caller names a
    kind, never a folder or a type, because the signature is computed over exactly those — an app
    cannot widen the folder or make a prescription public without invalidating it. A customer
    cannot sign a POD photo and a rider cannot sign a prescription; a test pins both.
  - **Prescriptions are `type: authenticated` and are never pruned.** A medical record, not a
    product photo: an `upload`-type asset is served from a public URL that can be forwarded and
    cached, `authenticated` means the delivery URL must itself be signed and expires.
  - **POD photos are kept 90 days.** That is the second decision that was riding along, and it is
    `pod_photo_retention_days` in `PlatformConfig` (editable from the Master settings screen), not
    a constant. ⚠️ **`npm run prune:uploads` is what enforces it and nothing schedules it yet** —
    point cron at it daily, or the answer to "how long are photos kept" is "forever" whatever the
    row says. It deletes by explicit public id, only from the `roadmate_pod` tag.
  - **A URL we did not issue is now refused.** `isOurAsset()` guards both the prescription endpoint
    and `deliver()` with a 400 `NOT_OUR_ASSET`. ⚠️ **Without credentials it passes any http(s)
    URL** — the same stub discipline as everything else here, and it is what keeps `.env.test`
    credential-free and every older test posting `example.com`.
  - **Proof stays optional and is never a disabled button.** The rider's proof section is not
    rendered at all when the server has no storage (probed once per job screen), and the OTP is
    still the delivery — a refused camera must never make an order undeliverable. Same on the
    customer side: the prescription camera appears only on an order that is actually waiting for
    one, and the signature is captured as **vector SVG** rather than adding `react-native-svg` +
    `react-native-view-shot` to six builds.
- **The live "in stock" promise** ✅ **DONE** (2026-08-09), alongside the above. Sold out is now a
  **state, not an absence**: a shelf row with nothing sellable used to be dropped from the response,
  which reads as "this shop does not stock it". Every available row now carries `inStock`, sold-out
  rows sort last, and the shop screen renders them dimmed with no stepper and no Add button. What
  stays absent is a row the shop switched off or that three stockouts auto-hid — the shop is not
  vouching for that count at all, so "sold out" would be a claim nobody made. The shop screen polls
  every **15s** (was 60); browse-by-product stays at 60s because it fans out across every
  serviceable shop. ✅ §7.6's last open part — whether "live" means the *number* — was answered the
  same day: **keep the exact count**, which is what ships. `inStock` stays a separate field from
  `availableQty` anyway, so the count could be withdrawn later without touching a screen; no screen
  may derive sold-out from `availableQty > 0`.

- **Subscription billing + the 3-month free trial** ✅ **DONE** (2026-08-09). The last item on
  §7ter, and the only thing on PLAN §8's list that was neither blocked nor an asset. **391 server
  tests green** (25 new in `tests/subscriptionBilling.test.js`), 10 in `packages/ui`, all six builds
  bundle, `client` builds. One additive migration,
  `20260809120000_partner_subscriptions_and_invoices` — `PartnerSubscription` and
  `SubscriptionInvoice`, two enums, **nothing altered and nothing backfilled**. The full reasoning
  is in §7ter; the short version, and the four things a later phase will trip over:
  - **`User.approvedAt` is the whole feature's foundation**, which is why it was landed on
    2026-08-07 ahead of anything that used it. A partner without one gets **no subscription row**
    and is reported as `trialStartKnown: false` everywhere — never a guessed date.
  - **Money is frozen at issue, an unset fee bills nobody, and phase is derived not stored.** Three
    rules, all of them versions of invariants this codebase already holds elsewhere.
  - **`npm run billing` is a fourth scheduled job** (sweeper · settlement · prune:uploads ·
    billing). Daily, one-shot, re-runnable. ⚠️ Like `prune:uploads`, **nothing schedules it yet** —
    and unlike prune, its absence means nobody is ever invoiced.
  - **§7bis.1 is finally fixed**: the District dashboard's fee rows are paid invoices, `basis` is
    `'BILLED'`, and the projection moved to its own column rather than being deleted.

- **The merchandising layer — and the shop-location gap under it** ✅ **DONE** (2026-08-09).
  **483 server tests green** (92 new: `shopLocation` 15, `productImages` 13, `coupons` 26,
  `autoApplyCoupons` 12, `merchandising` 26), 10 in `packages/ui`, all six builds bundle,
  `client` builds. One additive migration,
  `20260809092335_merchandising_banners_collections_autoapply` — `Banner`, `Collection`,
  `CollectionItem`, and `Coupon.autoApply`. **Nothing altered, nothing backfilled.** Ordering
  worked end to end before this; *promoting* did not exist at all. Seven things later work
  must respect:
  - ⚠️ **A shop's location could not be set anywhere in the product, and the gap was worse
    than it looked: no dashboard creates a shop at all.** The onboarding chain stops at
    Distributor/Executive, because shops are onboarded by field executives — who have no app
    and no dashboard (§4's known gap). So the fix is three surfaces, not one:
    `POST /api/partners/create` now **requires** `latitude`/`longitude` for `role=SHOP` (a hard
    400, never a default — a district centroid would send a real rider to the wrong address);
    `PATCH /api/shop/storefront` lets a shop correct its own pin; and
    `PATCH /api/partners/:id/location` is the operator's repair route for the shops already in
    the database with NULL coordinates. ⚠️ **The onboarding form was put on the Regional
    dashboard**, since REGIONAL is who approves shops — move it if a field-executive dashboard
    is ever built; the picker and all three endpoints are independent of where the form lives.
  - **A NULL-coordinate shop is invisible, not merely unranked**, and that is now said out loud
    in three places: `rankCandidateShops` prefilters on `@@index([role, latitude, longitude])`,
    so such a shop matches nobody, forever, while every other column says it is trading. The
    storefront sends `locationSet`, the Shop app's Home screen renders a danger banner **above**
    the open/closed switch (that switch is meaningless while the shop is off the map), and the
    Regional shop list counts them. `serviceRadiusKm` is deliberately **not** shop-settable —
    same rule as `safetyStockBuffer`: how far the platform sends a rider is a commercial term.
  - **The map is Leaflet + OpenStreetMap**, no key and no account, because the platform
    deliberately has no Google Maps key and hands off to Google Maps rather than embedding one
    (§6, Phase 3). `client/src/components/LocationPicker.jsx`. It does **not** geocode an
    address into a pin — a human puts the pin on the shop, for the same reason the Rider app
    navigates by coordinates and never by typed text.
  - ⚠️ **The hardcoded Unsplash stock photo is deleted and must not come back.** A blank
    `Product.image` used to be backfilled with a photograph of **somebody else's product**,
    shown to customers on the shelf as the real item, with nobody told. A product with no photo
    now has none; the apps already rendered that. `PRODUCT_IMAGE` and `BANNER_IMAGE` joined
    `UPLOAD_KINDS` with **their own tags** — `pruneUploads` deletes by tag, and either one
    carrying `roadmate_pod` would empty the catalogue 90 days after launch. Both writes are
    guarded by `isOurAsset()`, like the prescription endpoint and `deliver()`.
  - **Two new upload audiences, and the route decides them, never the request.** `catalogue`
    (MASTER/MANUFACTURER/DISTRIBUTOR/SHOP) and `merchandising` (MASTER). Widening
    `kindsFor('rider')` instead would have handed every rider on the platform the right to sign
    a catalogue asset the moment the kind was added.
  - **Coupons existed as a model and as `resolveCoupon()` and as nothing else** — no API, no
    screen, SQL only, which means none had ever been created. Now CRUD at `/api/master/coupons`
    plus `GET /api/customer/coupons`, so a customer no longer has to be *told* a code to use
    one. ⚠️ **A used coupon is never deleted** (409 `COUPON_IN_USE`): it is the recorded reason
    a delivered order was discounted and that order's money was frozen at delivery. Withdrawing
    is `isActive: false`. `phase` is derived from the clock, never stored — the same reasoning
    as `subscriptionPhase()`.
  - **`autoApply` reuses `resolveCoupon` one candidate at a time** rather than reimplementing
    the checks, so every window, scope, minimum and both usage limits are enforced by exactly
    the code a typed code goes through. Best = largest discount, id as tie-break. **A typed code
    always wins** — somebody given a code expects that code. It never errors: a coupon the
    customer never asked for and did not qualify for must not fail their order.
  - **A banner has a validity window and a collection has no money in it.** That is the whole
    difference between the two models. A festival banner switches itself off because the window
    is applied in the query, so nothing has to run; a banner opens **one** thing (three nullable
    target FKs, two at once refused, and a bad target fails at the write rather than on a
    customer's tap). A collection is curation only — no price, no discount, no settlement — and
    its item list is replaced **as a whole**, because order *is* the content and three verbs
    would make "move this to the top" a sequence that can half-fail.

## 7. Open questions for the client

Nothing here blocks launch any more except #1's sibling — the **rider pay rates**. Every other
number is either answered and recorded, or settable from the Master screen in a minute.

1. ~~**Manufacturer's monthly subscription fee**~~ ✅ **Answered 2026-08-07 — ₹10,000/month.**
   ⚠️ **And the other two changed, one of them downwards:** shop **₹5,000 → ₹3,000** (starting
   after the 3-month free trial) and distributor **₹10,000 → ₹5,000**. The old pair were code
   fallbacks nobody had ever chosen, and they had been quoting the wrong price on the District
   dashboard without anything looking broken — which is why the three `subscription_fee_*` keys
   now have **no code default at all**: a partner fee is a row a human wrote, or it renders "—".
   **Nobody has still ever been charged any of them** (see §7bis); billing is unbuilt.
1b. ~~**Rider pay rates**~~ ✅ **Answered 2026-08-07** — see §3's Riders row.
2. ~~**Riders: employees or independent gig workers?**~~ ✅ **Answered 2026-08-07** — independent
   partners, like Swiggy's. See §3's Riders row. Phase 3's earnings screen is unblocked.
3. ~~**Delivery fee and tax treatment.**~~ ✅ **Answered 2026-08-07 from the client's own spec** —
   `designs/Partner.png`'s bill panel reads Subtotal ₹125 / Tax ₹6.25 / Delivery partner fee ₹25
   / Grand Total ₹156.25, so `tax_percent` is 5 and `delivery_fee` is 25, both now recorded by
   `npm run config:apply`. ⚠️ **One flat tax rate across seven industries is still wrong** —
   Indian GST is per category, so the script also writes a per-industry override each (restaurant
   5, gym 18, pharmacy 5, goods 18, apparel 5). The client confirmed on 2026-08-07 that GST is to
   be handled per Indian rules — which endorses the per-category approach.
   ⚠️ **Still genuinely open: WHO collects and remits it** — the platform or the shop. That was
   not answered on the call and it is not a question code can decide; it needs the client's CA.
   It changes invoicing and settlement, not the rates.
4. ~~**Gym voucher validity**~~ ✅ **Answered 2026-08-07** — the shop sets price and duration.
   `ProductVariant.validityDays` is the duration; `voucher_validity_days` is now only the
   fallback for a variant that does not say. No invented numbers left in the codebase.
5. **Launch scale** — how many shops, how many riders, which district, on day one. Nothing
   architectural depends on it; the polling design needs revisiting somewhere around **500–1,000
   concurrent open shops** (push already exists to take the pressure off). The genuinely useful
   number is **riders per district** — serviceability needs a rider on shift in range, so a
   district with two riders is simply unavailable for parts of the day. Planning input, not a
   blocker.
6. ~~Live "in stock" indicator — has the client promised customers one?~~ ✅ **Answered
   2026-08-08 — yes, it was promised.** Mostly already true, which is why this was worth asking
   before building anything: `sellableQty()` is the only number that ever reaches a customer (the
   raw shelf count never leaves the server), the shop screen already caps every stepper at it and
   says "only N left" under 5, and a shop's own recount lands within one 60-second catalog poll.
   ✅ **The two halves it was missing were built 2026-08-09** (§6): an explicit sold-out *state* on
   both browse screens, and a 15-second shop-screen poll.
   ✅ **And the last part of it was answered 2026-08-09: keep publishing the exact count.** The
   question was whether "live" means the number, since a true live count publishes a shop's stock
   position to anybody who opens the app — competitive information the shop may not expect to be
   sharing — and "in stock / only a few left / sold out" would carry the promise without it. The
   answer is the number, which is what ships: "only 3 left" under five units, and the stepper
   capped at `sellableQty`. **No change was needed.** ⚠️ If a shop ever objects, `inStock` is a
   separate field from `availableQty` precisely so the count can stop being sent without touching
   a screen — and no screen may derive sold-out from `availableQty > 0`, or that stops being true.
8. ⏳ **Shop-owned delivery boys — the three money questions.** The feature's shape is settled and
   **its foundation is now built** (§3, §6, 2026-08-08): the switch, the pool partition,
   serviceability, the shop's staff screen and zero platform pay. These three decide the **ledger**
   and are the only things still missing, and guessing any of them produces wrong payouts:
   - **a. COD cash.** A shop's own boy takes the customer's cash. That money is already in the
     shop's hands — the platform never touches it. So settlement must **deduct** it from the
     shop's weekly payout rather than collect it. Recommended default if the client shrugs: yes,
     treat it exactly like a walk-in counter sale. Any other answer has the platform chasing a
     shop's employee for cash, which does not work.
   - **b. The ₹25 delivery fee.** It exists to cover paying *our* rider. On a shop-delivered
     order nobody is being paid by us. Charge it and pass it to the shop, charge it and keep it,
     or not charge it? Most likely the first — the shop bears the cost — but it is his call.
   - **c. Fallback.** Both of a shop's boys are out on deliveries and a new order lands. Does it
     wait, or does a platform rider take it as backup? The phrasing on the call sounded like a
     permanent per-shop setting rather than a per-order fallback, but "shop closes at 9, orders
     come till 11" is exactly when it bites.
   Two smaller ones asked alongside are **now built** (2026-08-08), because neither depends on the
   three above: the **shop** adds its own delivery staff from the Shop app (a field executive does
   not know a shop's employees), and RoadMate **pays a shop's boy nothing** — no ₹25 + ₹8/km, and
   no row in the weekly rider settlement. That last one is the whole difference between a delivery
   partner and somebody else's employee.
   ⚠️ **One thing (a) leaves standing today, and it is visible:** a shop's own boy who collects COD
   cash still has it recorded against him as platform-collected, so it appears in
   `GET /api/finance/cod-outstanding` as money the platform is owed. That is untouched on purpose —
   changing it *is* answer (a) — but it means the reconciliation view over-states what is coming in
   for any shop delivering its own COD orders. Nothing is wrong in the ledger; the label is.
7. ~~Separate Play Store listings for the executive apps?~~ ✅ **Answered, then re-answered.**
   2026-08-07: four listings. **2026-08-08: the client wants six apps — manufacturer, distributor
   and regional each get their own.** Built the same day; see §4. **Six listings, still three
   codebases.** ⚠️ The only outstanding cost is assets: four sets of icons, screenshots and store
   copy instead of two — **six across the platform**, counting Rider and RoadMate.

**Confirmed on the client call, 2026-08-07 — all recorded by `npm run config:apply`:**
rider pay **₹25 base / first 2 km free / ₹8 per km after** · shop subscription **₹3,000** after
the 3-month trial · distributor **₹5,000** · manufacturer **₹10,000** · GST handled per Indian
category rates.

**Re-confirmed 2026-08-08, because two of the three fees had moved and one had moved *downwards*:**
shop **₹3,000**, manufacturer **₹10,000**, distributor **₹5,000** — ✅ **not swapped; this is what
is in the database and on the District dashboard.** The pair that looks odd next to an old
screenshot is the *old* pair (shop ₹5,000, distributor ₹10,000), which were code fallbacks nobody
had ever chosen.

**Credentials, 2026-08-08:** ✅ **Cloudinary received** — in `server/.env`. ✅ **Both flows are now
built** (2026-08-09, §6): the rider's proof-of-delivery photo/signature and the customer's
prescription upload. ⏳ MSG91 and Razorpay are "within a few days"; both are code-complete and
stubbed, so each is env vars and no code change.
⚠️ The keys arrived pasted into `server/.env.test` and were **moved to `server/.env`**
(2026-08-08). Two things were wrong with where they were: the running server never reads
`.env.test`, so nothing would have been configured; and the test suite would have been making real
calls against the client's live account. `.env.test` is deliberately credential-free — that absence
is what makes every third-party library take its stub path under test.

**Answered 2026-08-07:** commission stays at **15%** (now a recorded `PlatformConfig` row via
`npm run config:apply`, not an undocumented fallback — he may revise it, which is one re-run) ·
shops sign in with **phone *or* email** ("also", not "instead") · MSG91 credentials are coming ·
~~a Master settings screen is agreed, to be built **after** the app work~~ ✅ **built 2026-08-07**
(§7ter) · a **3-month free trial then monthly charging** is a hard requirement from the manager.

## 7bis. Two things that are wrong today

1. ✅ **FIXED 2026-08-09 — the District dashboard reports real invoices now.**
   Subscription billing was built (§7ter), so the three fee rows are a sum over
   **paid `SubscriptionInvoice` rows**, `basis` is `'BILLED'` rather than
   `'UNBILLED_FEE'`, and the "NOT BILLED" tag and its banner are gone. The
   projection is kept in its own `projectedCollected` field and its own column,
   because "what should this district be earning" is a real question — it just
   must never be the same number as "what it earned". An `outstanding` column
   was added alongside: invoiced and unpaid is a third thing again, and it is
   never period-filtered, because a March bill still unpaid is still owed in
   August. ⚠️ A fee row reading ₹0 now means nobody has paid, which is true of a
   platform that has not launched. The original problem, for the record: `revenueController.js`
   computed "revenue" as a hardcoded monthly fee × partner count, for partners who have never been
   invoiced — a shop that signed up this morning added ₹5,000 to the table, forever, having paid
   nothing. There is no plan, trial, invoice or payment model anywhere in the schema.
   **Labelled, not deleted (2026-08-07):** each row now carries `basis: 'ORDERS' | 'UNBILLED_FEE'`,
   the dashboard tags the fee rows `NOT BILLED` behind a banner, the drill-down's "Fee Collected"
   column is now "Fee Due (unbilled)", and the footer shows **"Actually earned" and "Projected if
   billed" as two separate figures** — the sum of the two was the number that would mislead.
   That was the state until billing existed. It must never go back to it.
   ⚠️ **The "Delivery Subscriptions" row is now deleted**, not labelled — see §3's Riders row.
   Labelling was right for a fee that might one day be invoiced; a fee that will *never* be
   invoiced, because the platform pays that partner rather than billing them, is not a revenue
   category at all. A "Manufacturer Subscriptions" row replaced it, with its fee unset.
2. ~~**The B2B commission pool is hardcoded**~~ ✅ **FIXED 2026-08-07.** `totalAmount * 0.15` is
   `b2b_commission_percent` and the five tier shares are `tier_share_state|ind_state|district|
   regional|master`; the subscription fees are `subscription_fee_shop|distributor|manufacturer`.
   Every figure came across unchanged — `tests/b2bConfig.test.js` asserts the old numbers still
   come out by default — and all of them are now editable from the Master settings screen. A
   partner's own `User.sharePercentage` still beats the config default, as it always did.

## 7ter. Agreed, deferred, not started

- ~~**Master config screen**~~ ✅ **DONE 2026-08-07**, and it was promoted onto the critical path
  rather than left last: every commercial answer the client gave was "set it from the dashboard
  at the end", which makes this the *delivery mechanism* for commission, tax per industry,
  delivery fee, rider pay and all three subscription fees. `client/src/components/PlatformSettings.jsx`
  over `GET/PUT/DELETE /api/master/config` (`masterConfigController.js`), reachable from the
  Master sidebar under **Platform → Settings**. 13 tests. Four rules it enforces:
  - **MASTER only** (`restrictTo('MASTER')`), on all three verbs.
  - **A known key or nothing.** `PlatformConfig` is a free-form key/value table, so an unrecognised
    key is a 400 — otherwise a typo creates a row nothing reads, which looks exactly like a
    setting that silently did not apply.
  - **Blank clears, and is not 0.** Clearing falls a key back to what is behind it (override →
    global row → documented default). Unset means nobody has decided; 0 means somebody decided it
    is free, and `subscription_fee_manufacturer` is the live example of the first.
  - **The screen does not know what the keys are.** Labels, groups, units, help text and
    "is a per-industry override meaningful here" all come from `CONFIG_META` in
    `src/lib/platformConfig.js`. A new tunable number is three lines *there* and appears on the
    screen with no UI change. §7bis.2 was fixed as part of this.
- ~~**Subscription + 3-month free trial.**~~ ✅ **DONE 2026-08-09.** Both halves — (a) record and
  show the trial, and (b) collect the money — in one migration,
  `20260809120000_partner_subscriptions_and_invoices` (two new tables, two enums, nothing altered,
  nothing backfilled). **391 server tests green** (25 new in `tests/subscriptionBilling.test.js`),
  10 in `packages/ui`, all six builds bundle, `client` builds. Seven things later work must respect:
  - **The clock starts at approval, and a partner with no approval date gets no subscription.**
    `User.approvedAt` (2026-08-07) is what made this buildable at all. Every partner approved
    before that column existed has it NULL, and `ensureSubscription()` returns **null** for them
    rather than inventing a date — the API says `trialStartKnown: false`, the app says so, and the
    Master screen counts them. A backfill would have silently decided when a real business starts
    paying. ⚠️ There are such rows in the dev database today; somebody has to decide their dates.
  - **There is no `status` column, deliberately.** Trial-vs-active is a function of `trialEndsAt`
    and the clock; past-due is a function of an unpaid invoice past its due date. `subscriptionPhase()`
    derives both, once. A stored status is a second copy that goes stale the moment a scheduled job
    does not run, and a partner the database *says* is in good standing because cron died is worse
    than one that is visibly unbilled. The only stored state is `cancelledAt`, because nothing but
    a human decides that.
  - **The fee is frozen at issue.** `SubscriptionInvoice.amount` is written once from
    `subscription_fee_<role>`, exactly as `applyCommissionSplit()` freezes the commission at
    delivery and `computeRiderEarning()` freezes the rider's fee at the drop. Raising the fee
    reprices next month and never a month already invoiced; a test pins it.
  - **An unset fee produces no invoice, not a ₹0 one.** `subscription_fee_manufacturer` has no
    value and no default on purpose (§7.1), and `issueInvoicesFor()` **skips** that partner with a
    loud `FEE_NOT_SET`. ₹0 would be a bill saying the platform decided they owe nothing. Both silent
    non-billing cases are counted on the Master screen, because neither is visible anywhere else.
  - **`npm run billing` is the fourth scheduled thing, and it is a one-shot.** Point cron at it
    **daily** — an invoice is only created for a period that has already started, so a daily run
    bills each partner on their own anniversary rather than everybody on the 1st, and a day of
    downtime self-heals the next morning. Re-runnable by `@@unique([subscriptionId, periodStart])`,
    the same mechanism `Settlement` uses, and a three-month outage produces the three invoices that
    were owed with their real period dates on them.
  - **Nothing charges anybody.** As recommended: a manual invoice plus a Razorpay **payment link**
    the partner opens themselves (`createPaymentLink()` in `razorpay.js`, stubbing out without
    credentials like everything else), and `payment_link.paid` on the existing webhook marks it
    paid under the same conditional-claim discipline. No mandates, no auto-debit — that is worth
    building at a few hundred partners, not at launch. Money arriving by **bank transfer is the
    expected case**, and `mark-paid` requires a reference, because a payment nobody can match to a
    bank statement is not a record.
  - **A link is issued once per invoice.** Two links is two ways to pay one month, and two payments
    for one month is a refund conversation. A second request returns the first link.

## 8. Things that are out of scope

Migrating any Laravel data/users/order history · rider batching & multi-pickup · surge pricing ·
zone polygons · cash penalties on shops in year one · automatic recurring billing until the
client confirms it.
