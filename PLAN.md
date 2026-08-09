# RoadMate — Build Plan to Six Apps
Last updated: 2026-08-09 (subscription billing + the 3-month trial)

Companion to `HANDOFF.md` (framing, decisions, design system) and
`.grill/quick-commerce-six-apps.md` (reasoning). **This file is the execution plan** — what to
build, in what order, and what will block it.

---

## 0. Honest state of the repo

| Layer | State |
|---|---|
| **Schema** | ✅ Complete. Phase 0 applied (`20260806000000_phase0_two_flow_platform`), plus §1.9's two in-place `ALTER`s. ~40 models, both order flows, zero drift. |
| **API** | ⚠️ ~70%. `src/app.js` exposes **18 B2B + 3 master-config + health + 3 customer-auth + 16 customer + 17 shop + 9 rider + 3 pharmacy + 1 webhook + 1 finance route**. Phase 1 is complete: the consumer pipeline runs end to end headless — stock, money, and all four fulfilment types. Phase 2 added the shop's own inventory + storefront endpoints. |
| **Web dashboards** | ✅ 7 working portals in `client/`. Not part of the app build. |
| **Mobile** | ✅ **`apps/business` is complete and all four variants bundle.** All four roles: shop (9 screens) + the three partner roles (6 screens, one `(exec)` section). Ships as **four** Play Store listings — RoadMate Shop / Manufacturer / Distributor / Regional — from one codebase via `app.config.js` (HANDOFF §4, **revised 2026-08-08: the client wants six apps, so each business role gets its own**). Six listings platform-wide, still three codebases. `packages/ui` + `packages/api` shared. ✅ **`apps/rider` is complete** (Phase 3, 2026-08-08) — seven screens, one listing serving both kinds of rider, bundles clean. ✅ **`apps/consumer` is complete** (Phase 4, 2026-08-08) — ten screens, one listing, the sixth of six. All six builds bundle clean. |
| **Tests** | ✅ `node:test` + `supertest` against a real `roadmate_test` Postgres. **366 tests, all green** (`cd server && npm test`), plus **10** in `packages/ui` for the money helpers. |
| **Config** | ✅ Every tunable number is a `PlatformConfig` row *and* editable from the Master settings screen (`/master/settings` → `/api/master/config`). Nothing in either order flow is a constant any more: the B2B pool and its five tier shares moved out of `orderController.js` on 2026-08-07. |
| **Infra** | ⚠️ Scheduler done (`npm run sweeper` + `npm run settlement`, §1.5/§1.8). Razorpay coded, stubs out without credentials. Push (Expo Push) done. SMS (MSG91) coded 2026-08-07, stubs out without credentials — **two env vars from real**. ✅ **File storage done 2026-08-09** — `src/lib/cloudinary.js` + two signed-upload routes, live in `server/.env`; `npm run prune:uploads` is a **third** scheduled job and is **not yet scheduled anywhere**. ✅ **Billing done 2026-08-09** — `npm run billing` is a **fourth**, also unscheduled, and its absence is the loudest of the three: nobody is ever invoiced. |
| **Billing** | ❌ **Nothing exists.** No plan, trial, invoice or payment model. The agreed 3-month-free-trial-then-monthly is unbuilt; `User.approvedAt` (2026-08-07) is the one piece in place, because the clock starts at approval and that date is unrecoverable later. The District dashboard's fee rows are labelled as projections, not income — HANDOFF §7bis. |

The schema being done means all six apps finally have something to talk to. It does not mean the
backend is close.

---

## 1. Pre-work — do before Phase 1 code

✅ **DONE** (2026-08-06). One migration, `20260806045649_phase1_prework_decimal_money_and_push_tokens`,
all in-place `ALTER`s — the 28 trade orders / 30 items / 59 payouts are untouched. No drift.

- [x] **Convert B2C money fields to `Decimal`.** 28 columns moved `Float` → `Decimal(12,2)`
      (`Settlement` uses `(14,2)` — it aggregates a week). Scope as listed: `ConsumerOrder` (8),
      `ConsumerOrderItem.unitPrice`, `Payment.amount`/`refundAmount`, `Settlement` (5),
      `SettlementLine` (3), `ShopInventory.sellingPrice`, `ProductVariant.price`/`mrp`,
      `ProductAddOn.price`, `Coupon` (3), `DeliveryJob.riderEarning`/`deadRunFee`.
      B2B `Float`s deliberately untouched — 7 dashboards read them, and a test now asserts
      `TradeOrder.totalAmount` is still `double precision` so nobody "helpfully" converts it.
      ⚠️ **Prisma returns these as `Decimal` objects, not JS numbers.** Phase 1 code must use
      `.plus()` / `.toString()`, never `+`. Serialize with `.toFixed(2)` at the API boundary.
- [x] **Stand up a test runner.** `node:test` + `supertest`, 16 tests green. See §1.1 below.
- [x] **Add `deviceToken` / push registration.** Not a field — a `DeviceToken` model, because one
      account has several devices and re-registration must be idempotent (`token` is unique, so
      registration is an `upsert`). A device belongs to **either** a staff `User` **or** a
      `Customer`, enforced by a hand-written `DeviceToken_owner_xor` CHECK constraint in the
      migration, since Prisma cannot express it. `isActive` is the flag to flip when Expo returns
      `DeviceNotRegistered`.

### 1.1 How to run the tests

```
cd server
cp .env.test.example .env.test     # DB name MUST end in _test
npm test                           # migrate deploy + run
```

- **`tests/helpers/env.js`** loads `.env.test` and **throws unless the database name ends in
  `_test`** — a stray config can never truncate the dev database.
- **`tests/helpers/db.js`** owns rows only: `resetDb()` truncates every table with `RESTART
  IDENTITY CASCADE`, `seedBaseline()` builds one industry / master / shop plus the four
  `PlatformConfig` keys, `tokenFor(user)` mints the same JWT `login` issues.
- `npm test` uses **`migrate deploy`**, which is non-destructive and idempotent. `npm run
  test:db:wipe` is the destructive rebuild — run it by hand only if the test DB drifts.
- `--test-concurrency=1` is **required**: every file truncates one shared database.

**Also done, because the tests forced it:**
- **One shared `PrismaClient`** in `src/lib/prisma.js`. There were 8 — one per controller, so 8
  connection pools and a process that never exits. All 7 controllers + the auth middleware now
  import the singleton.
- **`src/app.js` / `src/index.js` split.** `app.js` exports the Express app with no port binding
  so supertest can mount it; `index.js` only calls `listen`. The inline `/api/industries` handler
  no longer constructs a `PrismaClient` per request.
- **`GET /api/health`** — public, no database. Liveness probe and the first thing a broken
  deploy should be checked against.

---

## 2. Phase 1 — consumer pipeline, headless

Highest-risk phase. No UI. Every step verified by API test.

### Where the B2C code lives (as of 1.4)

Read this before adding anything — most of what 1.5–1.9 needs already exists as a library.

| File | What it owns |
|---|---|
| `src/lib/shopRanking.js` | `rankCandidateShops()` — **the** candidate list, incl. `excludeShopIds` / `requireStock` for reroute · `hasRiderCoverage()` (**platform** riders only) · `shopsWithOwnRiderCoverage()` · `filterDeliverableShops()` — the one place "who can collect from this shop" is asked for both kinds of rider (2026-08-08) · `publicShop()` |
| `src/lib/platformConfig.js` | `getConfigNumber(key, industryId)`, `setConfig()`, `CONFIG_KEYS`. Nothing tunable may be a constant anywhere else. |
| `src/lib/inventory.js` | `sellableQty()` — the only definition of what the app may sell |
| `src/lib/cart.js` | cart loading, live pricing, `toMoney()` (Decimal → fixed-2 string) |
| `src/lib/coupon.js` | `resolveCoupon()` / `discountFor()` — refunds in 1.8 need the same maths |
| `src/lib/routing.js` | **§1.5.** `advanceOrder()` — the only "close this attempt, try the next shop". `reserveLines()` / `releaseLines()` · `openFirstAttempt()` · `beginRouting()` — **the one entry point for "a gate cleared, proceed"**, called by §1.8's webhook and §1.9's approval alike · `isRoutable()` = `isPayableNow()` + `prescriptionCleared()` · `cancelPlacedOrder()` (§1.9) · `recomputeFulfilmentRate()` |
| `src/lib/delivery.js` | **§1.7.** `assignRiderIfPossible()` (locks the rider row) · `ensureDeliveryJob()` · `decrementShelfOnDelivery()` — the one place `quantity` drops · `recordDeadRun()` |
| `src/lib/settlement.js` | **§1.8.** `commissionSplit()` · `applyCommissionSplit()` — the only place `commission_percent` becomes money on an order · `runSettlement()` · `runRiderSettlement()` (2026-08-07) |
| `src/lib/riderPay.js` | **2026-08-07.** `riderEarningFor()` / `computeRiderEarning()` — the only place a delivery becomes money for a *rider*. Frozen onto the job at delivery, exactly like the commission split. **Zero for a shop's own delivery boy** (2026-08-08): the shop pays him, not RoadMate. |
| `src/controllers/shopRiderController.js` | **2026-08-08.** `/api/shop/riders` — a shop's own delivery staff. "Remove" is `isActive: false`; `employerShopId` is never cleared, or an ex-employee lands in the platform pool. |
| `src/controllers/masterConfigController.js` | **2026-08-07.** `/api/master/config` — every tunable number, MASTER only. Known keys only, and blank clears rather than writing 0. |
| `src/lib/razorpay.js` | **§1.8.** `verifyWebhookSignature()` (real, always) · `createOrder()` / `refundPayment()` (stub out without credentials) |
| `src/jobs/sweepAttempts.js` | **§1.5.** `sweepExpiredAttempts()` + `recoverStalledOrders()`. Both take `now`, so tests never sleep. |
| `src/jobs/sweeper.js` | the process (`npm run sweeper`). Not a route — see §2.5. |
| `src/jobs/runSettlement.js` | **§1.8.** the weekly one-shot (`npm run settlement`). Not a route, and safe to re-run. |
| `src/lib/fulfilment.js` | **§1.9.** `fulfilmentTypeOf()` + the predicates every branch turns on — `isDelivered()` · `isVoucherOnly()` · `needsPrescription()` · `needsPrepTime()` · `isSupported()`. No controller spells out an enum comparison. |
| `src/lib/eta.js` | **§1.9.** `promisedEtaMinutes()` — the whole of COOK_AND_DELIVER |
| `src/lib/voucher.js` | **§1.9.** `issueVoucher()` (claimed, so a replayed webhook still mints exactly one) · `redeemVoucher()` · `publicVoucher()`. NO_DELIVERY lives here and **not** in `routing.js`. |
| `src/controllers/{prescription,voucher}Controller.js` | **§1.9.** the pharmacy gate; the counter's redemption |
| `src/lib/geo.js` | `haversineKm()`, `boundingBox()`, `parseLatLng()` |
| `src/lib/customerToken.js`, `src/middlewares/customerAuthMiddleware.js` | customer JWT (`aud: roadmate-customer`) + `protectCustomer` |
| `src/controllers/customer*Controller.js` | auth · catalog · cart · address · order. Thin — they parse input and shape JSON, nothing more. |
| `src/controllers/{payment,finance}Controller.js` | **§1.8.** the Razorpay order + webhook; the cross-rider COD reconciliation view. |

Tests: `tests/{customerAuth,serviceability,catalogCart,orderPlacement,customerAddress,routing,
shopResponse,delivery,payments,fulfilmentTypes}.test.js`, plus `tests/helpers/factories.js`
(`createIndustry`, `createShop`, `createRider`, `stockShop`, `createAddress`, …). **190 green.**

**1.1 Customer auth** ✅ **DONE** (2026-08-06) — 17 tests in `tests/customerAuth.test.js`, 33 green overall.
- [x] `POST /api/customer/auth/otp/request` — 6-digit code, bcrypt-hashed, 5-min TTL, max 5
      requests per phone per 10 min (429). Requesting again supersedes any live code.
      SMS is a stub (`sendOtpSms`) pending MSG91/Twilio; the code is returned in the response
      **only when `NODE_ENV !== 'production'`** — a test asserts production does not leak it.
- [x] `POST /api/customer/auth/otp/verify` — consumes the token, creates-or-reuses `Customer`,
      issues a JWT, refuses blocked customers (403). 5 wrong guesses lock the token out (429) and
      it is deliberately **not** consumed, so the correct code cannot be used afterwards either.
      Every failure returns the same "Invalid or expired OTP" — no phone enumeration.
- [x] **`protectCustomer`** in `src/middlewares/customerAuthMiddleware.js`, resolving `Customer`.
      Customer tokens carry `aud: roadmate-customer` (`src/lib/customerToken.js`, 30-day TTL);
      `protect` now rejects anything with that audience or without a `userId`. Existing staff
      tokens have no `aud`, so no live dashboard session breaks. Both directions are tested.
- Phones are normalised (`+91`/leading `0` stripped, 10 digits, leading 6–9) before hashing or
  lookup, so one human is always one `Customer` row.
- Customer routes mount in `app.js` **before** `app.use('/api', protect)`, since that line would
  otherwise apply the staff guard to them. `GET /api/customer/me` is the reference route.

**1.2 Serviceability + shop ranking** ✅ **DONE** (2026-08-06) — 16 tests in `tests/serviceability.test.js`.
- [x] `GET /api/customer/serviceable?lat&lng&industryId` — reports `serviceable` plus a `reason`
      (`NO_RIDER` / `NO_SHOP`) so the app can say *why*, not just "unavailable".
- [x] **`rankCandidateShops(lat, lng, industryId, options)`** in `src/lib/shopRanking.js` — a
      library, not controller code, because §1.5's sweeper calls it without HTTP. Options
      `excludeShopIds` (shops already offered), `limit`, and `requireStock` (shops that can
      currently sell a given line-item list) are exactly what reroute needs.
- [x] Bounding box on `@@index([role, latitude, longitude])` prefilters in the index, haversine
      in SQL refines. The box is built from the **widest `serviceRadiusKm` any open shop uses**,
      because radius is per shop and the config value is only a fallback.
- [x] Order: `routingPriority` DESC → distance ASC → `fulfilmentRate` DESC → id (stable, so a
      reroute cannot oscillate between two equal shops).
- [x] `hasRiderCoverage(lat, lng)` is separate — serviceability is *shop in range* **and** *rider
      on shift*, and the sweeper only wants the first.
- [x] `src/lib/platformConfig.js` — `getConfigNumber(key, industryId)` resolves per-industry
      override → global → documented default. `setConfig` is the only writer, which is what
      enforces "one global row per key" (Postgres cannot, per Phase 0's note).

**1.3 Catalog + cart** ✅ **DONE** (2026-08-06) — 19 tests in `tests/catalogCart.test.js`.
- [x] `GET /api/customer/shops/:shopId/products` (by shop) and
      `GET /api/customer/products?lat&lng` (by product, grouped across serviceable shops,
      cheapest offer first) — the hybrid browse, both halves.
- [x] `sellableQty()` in `src/lib/inventory.js`; raw `quantity` never leaves the server.
- [x] Cart CRUD (`GET/POST/PATCH/DELETE /api/customer/cart[/items]`). Adding from a second shop
      opens a second cart, it does not move the first. Same product+variant+add-ons increments
      one line. `sellableQty` is the ceiling on every add and update.
- [x] **Carts do not reserve stock.** Reservation happens once, atomically, at placement —
      reserving at add-to-cart lets an abandoned cart starve the shop.
- [x] `src/lib/cart.js` prices a cart against *today's* shelf, not the price when it was added.

**1.4 Order placement — the concurrency-critical step** ✅ **DONE** (2026-08-06) — 20 tests in
`tests/orderPlacement.test.js`, 7 more in `tests/customerAddress.test.js`.
- [x] `POST /api/customer/orders` inside a `$transaction`.
- [x] **Reservation is a raw conditional `UPDATE ... WHERE (quantity - reserved) >= n`**, never
      read-then-write. The two-customers-on-the-last-unit test is the first test in the file:
      one gets 201, one gets 409, one order exists, `reserved` is 1.
      ⚠️ Prisma's `updateMany` cannot express a column-to-column predicate, so this is
      `tx.$executeRaw`. Do not "clean it up" into a `findFirst` + `update`.
- [x] The buffer is applied *in reverse* at reservation: a customer taking `n` needs
      `ceil(n * 100 / safetyStockBuffer)` free units, so reserving does not eat the counter-sales
      cushion.
- [x] Placement **reserves, never decrements** — `quantity` drops at delivery (§1.8).
- [x] `shopId` stays **null** on the order; the cart's shop is only the first routing candidate
      (returned as `firstCandidateShop`). §1.5 turns it into `FulfilmentAttempt` sequence 1.
- [x] Coupons in `src/lib/coupon.js`: flat/percent, `maxDiscount` cap, `minOrderValue`, validity
      window, `isActive`, shop/industry scope, `usageLimit` and `perUserLimit`.
- [x] Bill panel assembled as `Decimal` throughout — `tax_percent` and `delivery_fee` come from
      `PlatformConfig` and **default to 0**, because the client has given neither number and an
      invented one is worse than a visible zero.
- [x] COD confirmed on placement; prepaid returns `requiresPayment: true` and waits on the
      Razorpay webhook (§1.8). The client's callback is never trusted.
- [x] Address book (`GET/POST/DELETE /api/customer/addresses`) — placement takes an `addressId`
      and there was no way to create one. Coordinates are required, not optional.
- [x] `GET /api/customer/orders` + `/:orderId`, scoped to the calling customer.

**1.5 Routing engine + the sweeper** ✅ **DONE** (2026-08-06) — 16 tests in `tests/routing.test.js`.
- [x] Placement creates `FulfilmentAttempt` sequence 1 at the cart's shop, `expiresAt = offeredAt +
      accept_window_seconds` via `getConfigNumber` (a test asserts the window is 45s when config says
      45, and that a per-industry override beats the global row).
- [x] **`src/lib/routing.js` — one `advanceOrder()`.** Timeout, reject and stockout all funnel
      through it, so "close this attempt and try the next shop" exists once. Candidates come from
      `rankCandidateShops({ excludeShopIds, requireStock })`; this file does not sort shops.
- [x] **The sharp edge: the reservation moves.** Release shop A's `reserved` and take it on shop B
      inside one transaction, and the take is the same conditional `UPDATE ... WHERE (quantity -
      reserved) >= needed` as §1.4 — because the new shop can sell out between being ranked and
      being offered. If a candidate's shelf refuses, the loop moves to the next one; the reservation
      is never left stranded. Both cases are tested.
- [x] **`src/jobs/sweepAttempts.js` + `src/jobs/sweeper.js`** (`npm run sweeper`) — a separate
      process, not a route. Reads `@@index([status, expiresAt])`.
- [x] **Idempotent by construction.** The `findMany` is only a shortlist; the authority is a
      conditional `updateMany` claim on `status = OFFERED AND expiresAt < now`, and count 0 means
      another worker won. Tested twice over: sequential double-sweep, and two sweeps racing.
- [x] `recoverStalledOrders()` — the crash net. An order that is `ROUTING` with no live offer (the
      process died between claim and re-offer) gets picked back up, because the alternative is an
      order nobody is looking at holding stock forever.
- [x] Exhausted candidates → `CANCELLED`, every reservation released, and the payment closed as
      `REFUNDED` (prepaid, with `refundAmount`/`refundedAt` set the moment the debt exists) or
      `FAILED` (COD, never collected). The gateway call itself is §1.8.
- [x] **An unpaid prepaid order is never offered.** `PLACED` now means exactly what the enum says —
      "not yet offered". The attempt row is still created at placement because it is the only record
      of *whose shelf holds the reservation*; `isPayableNow()` keeps the sweeper and the shop's inbox
      off it, and §1.8's webhook calls `beginRouting(orderId)` to start the window.
- ⚠️ **Fixed a pre-existing bug this depended on:** `getConfig` ordered by `industryId: 'desc'`, but
      Postgres sorts DESC as **NULLS FIRST**, so the global row beat every per-industry override —
      the exact inverse of the documented resolution order. Precedence is now picked in JS.

**1.6 Shop response** ✅ **DONE** (2026-08-06) — 18 tests in `tests/shopResponse.test.js`.
- [x] `GET /api/shop/offers` — the 60-second-timer screen's data, with `secondsRemaining` sent as a
      duration so a phone with a wrong clock still counts down correctly.
- [x] `POST /api/shop/offers/:orderId/accept` → `ACCEPTED`, binds `shopId`, stamps `acceptedAt`.
      **Accept is a claim**, `updateMany` on `status = OFFERED AND expiresAt >= now`: a tap that
      lands after the window loses cleanly (409) instead of binding an order the sweeper already
      rerouted. A test races accept against the sweeper; the shop keeps the order.
- [x] The reservation needs no work on accept — placement or the reroute already put it on *this*
      shop's shelf. Accepting commits it by leaving it alone.
- [x] `POST .../reject` → releases and re-offers immediately; the customer does not pay 60 seconds
      for a shop's honesty.
- [x] `POST /api/shop/orders/:orderId/stockout` → `STOCKOUT`, `consecutiveStockouts + 1` per SKU in
      the **same transaction as the claim** (via `advanceOrder`'s `onClaimed`), auto-hidden at
      `stockout_hide_threshold` (config, default 3), order unbound and rerouted.
- [x] `PATCH /api/shop/orders/:orderId/status` — `ACCEPTED → PREPARING → READY`, explicit transition
      table, conditional update so two taps cannot walk two steps. `DELIVERED` is not the shop's to set.
- [x] `fulfilmentRate` recomputed as `accepted / responded`. **`routingPriority` is deliberately not
      touched** — it is the operator's manual demotion lever, and two writers would mean an automated
      recompute silently undoing a human decision. Ranking already sorts on `fulfilmentRate`.

**1.7 Delivery** ✅ **DONE** (2026-08-06) — 18 tests in `tests/delivery.test.js`.
- [x] `src/lib/delivery.js` — job creation is idempotent; assignment happens when the shop marks
      READY, so a rider never polls for work.
- [x] **The contended row is the rider, not the job**, so assignment takes `SELECT ... FOR UPDATE`
      on the rider before counting their live jobs. Tested: two orders going READY together land on
      one rider each, and the second job waits rather than double-booking.
- [x] No rider on shift → the job stays `UNASSIGNED` (a queue, not a failure) and is handed out when
      a rider clocks in.
- [x] `POST /api/rider/shift` — `RiderShift` + `User.isOnShift`, idempotent, and **refused while
      carrying an order** (mid-flight reassignment is a Phase 3 problem).
- [x] `POST /api/rider/location` — overwrites `lastLat`/`lastLng`/`lastLocationAt`.
- [x] Pickup → `PICKED` (blocked until the shop is READY). Delivery verified by a 4-digit
      `crypto.randomInt` `otpCode`; POD photo / signature / note stored.
- [x] **Delivery is where `quantity` finally drops**, with `reserved` coming down in the same
      statement, plus `consecutiveStockouts = 0` — "consecutive" means consecutive. This was listed
      under §1.8, but it is stock, not money: leaving it there would have meant every delivered
      order permanently overstated the shelf. The commission split and settlement accrual stay in §1.8.
- [x] COD cash recorded at the door: `collectedByRiderId` + `cashCollectedAt`, `cashRemittedAt`
      deliberately null — the rider is holding the platform's money until they hand it in (§1.8).
- [x] Dead run → `isDeadRun`, `deadRunFee` = `riderEarning` from config (**defaults to 0**; the
      client has given no figure), order cancelled, stock returned, shop not deducted.
- [x] **PLAN §2's exit criterion is a test**: placed → timed out on shop A → rerouted → accepted by
      shop B → packed → assigned → picked → delivered, with both shelves asserted at every step.

**1.8 Money** ✅ **DONE** (2026-08-06) — 21 tests in `tests/payments.test.js`, **168 green overall**.
- [x] `POST /api/customer/orders/:orderId/razorpay-order` (PREPAID only, idempotent — a second call
      returns the same gateway order, because two would leave the first uncompletable) and
      `POST /api/payments/razorpay/webhook`.
- [x] **The signature is the authentication.** The webhook is public and unguarded by middleware;
      `verifyWebhookSignature()` HMACs the *raw* body against `RAZORPAY_WEBHOOK_SECRET` and compares
      timing-safely. `express.json({ verify })` in `app.js` stashes `req.rawBody` — a re-serialised
      `req.body` is not guaranteed byte-identical and would fail every real signature. A missing
      secret fails **closed**. The client's own checkout callback is never trusted for anything.
- [x] Marking PAID is a conditional `updateMany` on `status = PENDING`, the same claim discipline as
      §1.5, and only the caller that wins it calls `beginRouting()`. A Razorpay retry after the shop
      has accepted is a no-op, not a second attempt row — that is a test.
- [x] **The split is frozen at delivery**, in `riderController.deliver()`'s transaction, via
      `applyCommissionSplit()` in `src/lib/settlement.js` reading `commission_percent` from
      `PlatformConfig` (per-industry override respected). Changing the config afterwards does not
      rewrite a delivered order — also a test. ⚠️ The default 15 is still the undocumented number
      from `orderController.js:196`; it is nowhere on a shop-facing screen (§7.1).
- [x] COD cash-in-hand: `GET`/`POST /api/rider/remittance` (what I'm holding / hand it all in) and
      `GET /api/finance/cod-outstanding` (MASTER-only, every rider, oldest-collection timestamp).
      Remitting is a conditional `updateMany` re-asserting `cashRemittedAt: null`, so a double tap
      or a delivery landing mid-request cannot double-count.
- [x] **Refunds are recorded before they are attempted.** `closePaymentAsRefundable()` still writes
      `REFUNDED` + `refundAmount`/`refundedAt` inside the cancelling transaction; the gateway call is
      fired **without `await`** (`void … .catch()`) so an unreachable Razorpay cannot hold that
      transaction's locks. The `Payment` row is the truth; the API call is best-effort.
- [x] **`npm run settlement`** — `src/jobs/runSettlement.js`, a one-shot script next to the sweeper,
      not a route. Defaults to the last completed Mon→Mon UTC week; takes explicit ISO dates.
      Re-runnable: `runSettlement()` skips any shop+period already settled and any order already on
      a `SettlementLine`, so an interrupted week can just be run again.
- [x] `src/lib/razorpay.js` **stubs out** when `RAZORPAY_KEY_ID`/`_SECRET` are absent — same shape as
      `sendOtpSms`. Signature verification is real either way. No test makes a network call.

**1.9 Fulfilment-type branches** ✅ **DONE** (2026-08-06) — 22 tests in `tests/fulfilmentTypes.test.js`,
**190 green overall**. One migration, `20260806120000_phase1_9_fulfilment_type_branches`, two in-place
`ALTER`s (`ConsumerOrder.addressId` nullable, `User.prepTimeMin` added). No drift.
- [x] `PICK_AND_DELIVER` — the default path above. Untouched; every other test file is its regression test.
- [x] `COOK_AND_DELIVER` — `src/lib/eta.js`. `promisedEtaMin = base_eta_min + ceil(km × eta_min_per_km)
      + prep`, where `prep` is non-zero **only** for this type: the shop's own `User.prepTimeMin`, or the
      industry's `prep_time_min` config row when it has not set one. Written at placement against the
      first candidate and **remade at accept** against the shop that actually binds — placement's number
      was about a shop a reroute may have left behind. Nothing else in the pipeline learns restaurants exist.
- [x] `VERIFY_AND_DELIVER` — `POST /api/customer/orders/:orderId/prescription` (takes a **URL**; file
      storage is still unbought, §6) plus `GET /api/pharmacy/prescriptions` and `.../:id/approve|reject`,
      **MASTER-only**: the order has not reached a shop yet, and a shop verifying an order it is about to
      be paid for is the wrong incentive. The gate is §1.8's mechanism exactly — `PLACED` with the attempt
      row parked, `beginRouting()` makes it live. Payment and approval are **independent gates**, and each
      caller re-checks *all* of them, so the second to clear starts the window and neither door knows about
      the other. Rejection calls `cancelPlacedOrder()`, which exists to give the shelf back.
- [x] `NO_DELIVERY` — `src/lib/voucher.js` + `POST /api/shop/vouchers/redeem`, `GET /api/shop/vouchers/:code`.
      No rider, no stock, no address, no `DeliveryJob`, **no `FulfilmentAttempt`** — and deliberately not
      routed through `advanceOrder()`. The order binds `shopId` at placement (you join *that* gym), waits
      at PLACED for the webhook, and `beginRouting()` hands off to `issueVoucher()`.
- [x] Both §8 breakages fixed: placement's `addressId` requirement and rider re-check are now inside an
      `isDelivered(fulfilmentType)` branch, and `runSettlement()` needed no change — a NO_DELIVERY order
      binds a `shopId`, so its `shopId: { not: null }` filter was already right. A test pins the payout.

**Exit criteria:** an API-only test places an order, watches it time out on shop A, reroute to
shop B, get accepted, assigned, delivered, and settled — with correct stock and money at every step.
✅ **Met.** The stock half is the last test in `tests/delivery.test.js`; the money half is
`tests/payments.test.js`. The only thing standing between this and real money is the client's
commission number and a Razorpay account — both one `UPDATE` / one env var away (§7.1, §7.2).

---

## 3. Phase 2 — RoadMate Business app

Four of six apps. Designs are complete; the B2B API already exists. Cheapest phase per app shipped.

- [x] **Monorepo.** ✅ **DONE** (2026-08-06). npm workspaces (`apps/*`, `packages/*`) + Expo SDK 57,
      React Native 0.86, expo-router. `client/` and `server/` are deliberately **not** workspaces —
      they have their own lockfiles and are installed with `--prefix`, and hoisting two working
      deployments buys nothing. `apps/business/metro.config.js` is what makes the shared packages
      resolve: `watchFolders` on the workspace root, `nodeModulesPaths` local-then-root. Verified by
      `npx expo export --platform android` bundling clean.
- [x] **`packages/ui`** ✅ **DONE** — `tokens.js` (#DEBE10 + `onAccent`, because mid-yellow never
      takes white text; status colours keyed to *both* status vocabularies, since the shop sells with
      `ConsumerOrderStatus` and buys with the B2B capitalised strings), `money.js`, and the
      primitives (`Card`/`ListRow`/`StatTile`/`StatusPill`/`Countdown`/`QuantityStepper`/`Button`).
      **Money is the part that matters:** `formatINR` formats a fixed-2 *string* by manipulating the
      string, and `addMoney`/`mulMoney` work in integer paise via `BigInt`, so nothing on the client
      can reintroduce the float error the 28 `Decimal` columns exist to prevent. `mulMoney` refuses a
      fractional multiplier on purpose — a percentage is the server's arithmetic and a second answer
      would disagree with the ledger. `formatAmount` handles the B2B `Float`s. **10 tests**
      (`npm test --workspace packages/ui`), including the hundred-×-₹0.07 drift case.
- [x] **`packages/api`** ✅ **DONE** — `createClient` + `ApiError`, which keeps `status` and the
      backend's machine-readable `reason` (`OFFER_CLOSED`, `BELOW_RESERVED`, `NEEDS_CONFIRMATION`,
      `ALREADY_REDEEMED`). Those are outcomes to show, not errors to retry, and `isConflict` /
      `isNetwork` / `isAuth` are what the screens branch on. `shopApi` is every endpoint the shop
      touches, both flows, in one file.
- [x] **Shop role** ✅ **DONE** (2026-08-06) — `apps/business`, five tabs:
  - [x] Incoming consumer order + 60s countdown ⚠️ *not in designs — built in HANDOFF §5's language,
        send to UI/UX for polish.* The countdown runs off the server's `secondsRemaining` **duration**
        (a wrong phone clock cannot skew it) and anchors on elapsed wall time rather than decrementing,
        so a backgrounded app does not drift. At zero it re-asks the server instead of deciding the
        offer is dead. **A 409 on accept renders as "this order moved on" and never retries.**
  - [x] Order lifecycle: accepted → packing → ready ⚠️ *not in designs.* READY is labelled as what it
        actually does — call a rider. Stockout is behind a confirmation that states the consequence.
  - [x] Stock management ⚠️ *not in designs* — and it needed an API, see below.
  - [x] B2B restock ✅ *designed* (`designs/Partner.png`) — search, brand chips, two-column grid with
        steppers, cart grouped **by seller** because `POST /api/orders/create` takes one `sellerId`, so
        a basket spanning two distributors is two trade orders and the shop sees that before it taps.
  - [x] Voucher redemption counter ⚠️ *not in designs* — look up, then redeem; §1.9's two endpoints.
  - [x] Home + Profile ✅ *designed*. The "Shop is open" toggle is wired to `isOpen`, which is what
        `rankCandidateShops` filters on — it is the shop's switch out of the routing pool, not a display
        preference.
- [x] **New backend: the shelf, from the shop's side.** ✅ **DONE** — `shopInventoryController.js`,
      `GET`/`POST /api/shop/inventory`, `PATCH /api/shop/inventory/:id`,
      `POST /api/shop/inventory/:id/confirm`, `GET`/`PATCH /api/shop/storefront`. **23 tests, 213
      green overall.** This did not exist: every previous reader of `ShopInventory` was customer-facing
      and read-only, and the only writers were the pipeline itself, so "live per-shop stock maintained
      by shop owners" (HANDOFF §3) had no way to be maintained. Two rules it enforces:
  - **The shop owns `quantity`, the pipeline owns `reserved`.** A count correction may never take the
    shelf below the units already promised to in-flight orders, and the write is a conditional
    `updateMany` re-asserting that in the database — the same claim discipline as §1.4/§1.5, because
    a reservation can land between the read and the write. A test does exactly that.
  - **`/confirm` is HANDOFF §3's missing half.** Three consecutive stockouts auto-hide a SKU "until
    re-confirmed" and nothing could re-confirm it. It is now the *only* thing that clears
    `consecutiveStockouts`, and `PATCH … {isAvailable: true}` on an auto-hidden row is refused with
    `NEEDS_CONFIRMATION` — flipping a switch is not a recount.
- [x] **Distributor / Manufacturer / Regional exec roles** ✅ **DONE** (2026-08-06) — six screens in
      `apps/business/app/(exec)`, **no new backend**: `dashboardController.getOverview` already
      branches per role, and `partnerController` / `orderController` / `productController` are the
      same endpoints the seven web dashboards call. `packages/api/src/executive.js` describes them;
      `apps/business` bundles clean (`npx expo export --platform android`). Five things later work
      must respect:
  - **One `(exec)` section, not three.** The three roles differ only in *which endpoints return
    something*, and that is a table — `apps/business/src/roles.js` — read by the layout, the home
    screen and the profile. A Manufacturer falls through `getActivePartners`' role ladder to its
    fail-safe empty clause and through `getPendingApprovals`' to `[]`, so its Network tab is hidden
    rather than shown empty; a Regional partner sells nothing, so it has no Products tab. Adding a
    role is a row in that file, not a fourth section (HANDOFF §4's "one tab varying", literally).
  - **`updateOrderStatus` is not idempotent, and the UI is what protects it.** `Approved` and
    `Dispatched` each decrement `Product.stockLevel` with no guard, so calling one twice takes the
    seller's stock down twice; `Delivered` writes the commission payouts. The order detail therefore
    offers **exactly one next rung** of a fixed ladder (`src/tradeOrder.js`), never a status picker,
    never the status the order is already on, and always behind a confirmation naming the
    consequence. This is the opposite of the B2C side's discipline — there the *server* re-asserts
    the reason for acting; here the endpoint predates that idea and cannot, so the app must not
    offer the tap. **If this endpoint is ever hardened, do it with a conditional `updateMany` on the
    current status**, the same claim shape as §1.5, and the UI guard becomes belt-and-braces.
  - **The two order flows collided on method names.** `shopApi.listOrders` / `setOrderStatus` are
    the *consumer* inbox; the trade equivalents are deliberately `listTradeOrders` /
    `setTradeOrderStatus`, because `session.js` merges both surfaces into one client and a
    collision would have silently swapped a shop's offer inbox for its purchase history. Both
    flows meet in this app (HANDOFF §1) — any third surface added here must check for the same.
  - **No commission percentage on any executive screen either**, same rule as the shop's (§7.1).
    Regional's `myShare` and its settled `Payout` rows *are* shown: those are figures the server
    computed and returned, not a rate the app would be asserting. The undocumented 15 stays
    invisible.
  - **`creditLimit` / `outstandingDue` needed no endpoint** — they ride along on
    `getActivePartners`' full user rows, and only a Distributor is shown them, because only a
    distributor is owed money by the shops it supplies.
- [x] Role-driven navigation from one codebase ✅ **DONE** — `app/index.js` routes `SHOP` → `(shop)`,
      the three executive roles → `(exec)`, a delivery executive to an honest "wrong app", and
      everyone else (MASTER/STATE/DISTRICT/IND_STATE) to "your role works from the web dashboard".
      Expo app variants remain the answer if the client demands separate store listings — still one
      codebase, never four (open question §7.6).

---

## 4. Phase 3 — Rider app

`LAST_MILE` only. `TRADE_ROUTE` (the designed multi-drop barcode flow) waits for B2B volume.

✅ **Built 2026-08-08. Two kinds of rider, one app.** A shop either uses its own delivery boys
or RoadMate's (HANDOFF §3). The *delivery flow is identical* for both — pickup, OTP, proof,
tracking — so this stays **one codebase and one Play Store listing**. What differs is ownership
and money, not screens. Split into what is safe to build now and what is not:

**Safe now — correct however the money questions land.** ✅ **ALL DONE** (2026-08-08), migration
`20260808090000_shop_owned_delivery_riders`, **19 tests** in `tests/shopOwnRiders.test.js`,
**321 green overall**:
- [x] `User.usesOwnRiders` on the shop · `User.employerShopId` on the rider. One additive migration
      — two columns, one index, nothing altered or backfilled.
- [x] `assignRiderIfPossible()` picks from the shop's own staff when the shop has them, via
      `freeRidersNear(..., employerShopId)`, and the claim re-asserts employment under the rider
      lock so a hire landing between ranking and claiming is seen.
      ⚠️ **And the platform pool excludes shop-employed riders** — `employerShopId IS NULL`,
      unconditionally, not "unless his employer has switched the mode on". That exclusion was the
      sharp edge of this whole feature and it needed to be in a **third** place nobody had listed:
      `hasRiderCoverage()` was still counting somebody else's employee as platform coverage, which
      advertised every shop around him as deliverable by a rider who would never be sent to them.
      A test caught it.
- [x] Serviceability counts a shop's own riders on shift — measured from the **shop**, not from the
      customer, because he is that shop's employee and starts there. `filterDeliverableShops()` is
      the one place the two questions are asked together, and it filters the routing `candidates`
      rather than just the yes/no, so a shop nobody can collect from is not a reroute target
      either. A shop with its own boys is serviceable where the platform has no coverage at all,
      which is the launch-scale win.
- [x] Shop app: `app/(shop)/delivery.js` — the mode switch, the roster, who is on shift and who is
      out on a drop, add and remove. Reached from Profile, not a sixth tab. Backed by
      `GET`/`POST /api/shop/riders` + `PATCH /api/shop/riders/:riderId`. **"Remove" is
      deactivation, never unlinking**: clearing `employerShopId` would push an ex-employee into the
      platform pool, which is the failure the partition exists to prevent.
- [x] Rider app: a shop's boy sees no platform earnings screen — `GET /api/rider/earnings` answers
      403 `EMPLOYED_BY_SHOP`, and `GET /api/auth/me` carries `employerShopId` + `employerShop.name`
      so the app can hide the tab and say who does pay him. His deliveries and dead runs freeze
      `riderEarning` **0**, and `runRiderSettlement()` skips him — a ₹0 settlement is not a
      settlement.

**⛔ Blocked on HANDOFF §7.8 — do not touch settlement until the client answers.** Nothing above
touched it: `runSettlement()` is unchanged, and the only line added to `runRiderSettlement()`
excludes riders the platform does not pay at all.
- [ ] COD cash collected by a shop's own boy → deducted from the shop's payout, not collected.
      ⚠️ Until this is answered his cash is still recorded as platform-collected and shows up in
      `GET /api/finance/cod-outstanding`, which over-states what is coming in. Deliberate — the fix
      *is* the answer — but do not read that view as truth for a self-delivering shop.
- [ ] Whether the ₹25 delivery fee is charged, and who receives it, on a shop-delivered order.
- [ ] Whether a platform rider backs up a shop whose own boys are all busy.

**The app itself.** ✅ **DONE** (2026-08-08) — `apps/rider`, **13 tests** in
`server/tests/riderApp.test.js`, **334 green overall**, bundles clean. No migration: the whole
rider backend already existed, and the only server change was additive fields on the session
payload (`executiveType`, `isOnShift`, and `employerShop*` on `login` as well as `getMe` — `login`
and `getMe` now share one `publicUser()`, because a field on one and not the other is a screen that
works until the app is reopened).
- [x] Shift on/off, live location reporting. The shift is **server-owned and never optimistic** — a
      409 while carrying a job leaves the toggle on. Location runs **only** while on shift,
      foreground permission only, 20s plus a report on foregrounding, and a failed report is
      dropped rather than queued: `hasRiderCoverage()` reads it, so a stale position takes shops
      out of serviceability, and a queued one is worthless once a newer fix exists.
- [x] Consumer job card / pickup / deliver / nav ⚠️ *not in designs* — built in HANDOFF §5's
      language. **Nav is a hand-off to Google Maps by coordinates**, not an in-app map: the order
      was routed by lat/lng and a text search lands riders on the wrong road.
      ⚠️ **The ladder is two rungs, not four** — `EN_ROUTE_PICKUP` / `AT_PICKUP` exist in the enum
      and no endpoint sets either. `src/job.js` draws what exists.
- [x] POD: **OTP and note.** ⛔ photo/signature still need file storage (§6) — `deliver()` and
      `riderApi` already carry the two URL fields, so the app uploads first and no endpoint
      changes. Deliberately **no disabled camera button**.
- [x] COD cash collected → remitted reconciliation screen. Hand-in is all-or-nothing, matching the
      endpoint's single conditional claim. ⚠️ It counts a shop's own boy's cash too, because
      §7.8a is unanswered — the screen says so rather than inventing the answer.
- [x] Earnings view — ✅ **unblocked 2026-08-07**, built 2026-08-08. The backend was done and tested:
      `GET /api/rider/earnings` returns today's takings, everything settled and not yet paid, the
      settled periods, and the rates themselves. The rates *are* shown, unlike
      `commission_percent`: a rider is entitled to know how their own pay is worked out, and it is
      their rate rather than a cut the platform takes. What it renders comes from frozen
      `DeliveryJob.riderEarning` columns and `RiderSettlement` rows — never a recomputation, so
      the screen cannot disagree with the ledger. **Hidden entirely for a shop's own delivery
      boy** — the tab is not rendered and the endpoint answers 403 `EMPLOYED_BY_SHOP`, which the
      screen handles by name in case he deep-links to it.

---

## 5. Phase 4 — Customer app

✅ **DONE** (2026-08-08). `apps/consumer`, **18 tests** in `server/tests/consumerApp.test.js`,
**352 green overall**, all six builds bundle. **No migration and no new endpoint** — Phase 1 built
this pipeline headless precisely so this phase would be screens over an API that already answered.

- [x] Phone + OTP onboarding — no password, because `Customer` has no password column. The
      development code is shown in a labelled banner, since SMS is stubbed until MSG91 lands.
- [x] Address book with a pin. ⚠️ **Not a draggable map** — that needs `react-native-maps` and a
      Google Maps key nobody has bought, and the platform already hands off to Google Maps rather
      than embedding one. The device's own fix is the pin, reverse geocoding prefills the text, and
      the fix's accuracy is shown rather than hidden. Coordinates are refused-if-absent by the
      server and by the form, because the rider navigates by them and not by the typed street.
- [x] Industry switcher (7 industries), hybrid browse: by shop **and** by product. The switcher is
      a filter, never a navigation — seven industries are not seven apps.
- [x] Variants + add-ons, cart, coupons, checkout (COD; prepaid behind a key — see below).
      ⚠️ Browse-by-product deliberately **opens the shop rather than adding to a cart**: that
      endpoint groups across shops and so cannot carry a product's add-on groups, and a one-tap add
      would silently skip a *required* one.
- [x] Live tracking — **polling every 10s**, and it stops once the order settles. Sockets stay the
      upgrade path *if this visibly fails*, not before.
- [x] Cancelled / rerouted states. A reroute is drawn from `attempts` and never names the shop that
      declined.
- [x] Gym voucher — **the code, not a QR image**. The shop's app redeems by looking a code up
      (`GET /api/shop/vouchers/:code`) and has no scanner, so a QR would imply a flow that does not
      exist. `voucher.qrPayload` is on the record for when one does.
- [ ] ⛔ **Prescription upload** — the one customer flow that cannot be completed. Blocked on file
      storage (§6), so there is deliberately **no camera button**; checkout says a pharmacy order
      will wait at the pharmacist's gate and the order screen names that gate.
- [ ] ⛔ **Online payment** — blocked on the Razorpay account. With no `EXPO_PUBLIC_RAZORPAY_KEY_ID`
      the app offers cash on delivery only and says why. ⚠️ Because `NO_DELIVERY` is PREPAID-only on
      the server, **gym memberships cannot be bought at all today** — the home screen says so before
      a cart is filled.

**Also done, because Phase 3 said it would be:** `useResource` became `packages/hooks`. It had been
copied from `apps/business` into `apps/rider` with a note that a third copy would flip the trade;
this was the third. The two files were byte-identical apart from their comments. ⚠️ One file, three
apps — a change there breaks all three, so check all six builds bundle.

---

## 6. Cross-cutting infrastructure

Each blocks a phase. None are in the original build order.

| Need | Blocks | Note |
|---|---|---|
| **File storage** (Cloudinary) | ~~1.9~~ ~~3~~ 3's POD photo, 4's prescription upload | `Prescription.imageUrl`, `DeliveryJob.photoUrl`/`signatureUrl`, logos, product images all point at a service that does not exist. Every upload endpoint takes a **URL**, so when storage lands the app uploads there first and no endpoint changes. ⚠️ **It did not end up blocking Phase 3** — the Rider app shipped without it (2026-08-08) because OTP, note, cash and earnings need no file. What it still blocks is the *photo and signature* half of proof-of-delivery, and — now that Phase 4 has shipped around it too — **prescription upload, the one customer flow that cannot be completed**. Neither app has a disabled button for it; both say what is missing. Two decisions ride along: how long POD photos are kept, and that prescription uploads get **private/signed** URLs — medical records, not product photos. |
| **Push notifications** (Expo Push) | 2 (shipping, not building) | `DeviceToken` model exists. **§1.5–1.7 do not depend on it** — a shop's offer inbox and a rider's job list are both pollable endpoints, and the shop app polls offers every 5s, so the pipeline works without push. Push only makes the 60-second timer *noticeable*. Deliberately done **after** the first screens: an Expo push token comes from a running app on a real device, so there was nothing to register until one existed. It is now the top of §8. |
| **SMS provider** (MSG91) | ~~1.1~~ launch | ✅ Code done 2026-08-07. `src/lib/sms.js` stubs out until `MSG91_AUTH_KEY` / `MSG91_TEMPLATE_ID` are set, exactly like `razorpay.js` — no caller, route or schema changes when they land. The client has a subscription and is handing over credentials. Needs one approved DLT template with a single OTP variable. Production answers 502 `SMS_DELIVERY_FAILED` rather than claiming "OTP sent" for a code nobody will receive. Still the last thing between the platform and a real customer login |
| **Razorpay account** | ~~1.8~~ launch | ✅ Code is done and tested. `src/lib/razorpay.js` stubs out until `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` are set, at which point order-create and refunds become real calls with no code change. Point the dashboard webhook at `POST /api/payments/razorpay/webhook`. COD-only is a test stopgap, not a launch |
| **Realtime** | ~~4~~ | ✅ Polling, as planned: tracking re-asks every 10s and stops when the order settles. Sockets remain the upgrade path *if that visibly fails* — it has not been run against real load yet, so this is a decision that stays open rather than one that is closed |
| **Scheduler** (node-cron/worker) | ~~1.5, 1.8~~ | ✅ `npm run sweeper` — plain `setInterval`, no node-cron dependency, graceful SIGTERM drain. Deploy it **next to the API as its own process**; one replica is enough and two are safe. ✅ `npm run settlement` is the second job — a one-shot, so point cron/a k8s CronJob at it weekly rather than leaving it running. It settles **shops and riders** in the same run (2026-08-07). |
| **Billing** (subscriptions) | ~~HANDOFF §7ter~~ | ✅ Built 2026-08-09. `npm run billing` — a **fourth** scheduled job, one-shot like settlement, point cron at it **daily**. Re-runnable by `@@unique([subscriptionId, periodStart])`; a missed month self-heals with its real period dates. Razorpay payment links stub out without credentials exactly like everything else |
| **Error tracking / logs** | all | Currently one global handler that swallows everything |

---

## 7. Client blockers, ranked by damage

1. ~~**Commission %**~~ ✅ confirmed at **15%** and recorded as a `PlatformConfig` row by
   `npm run config:apply` (2026-08-07) — it is a decision now, not an undocumented fallback. The
   client may revise it, which is one field on the Master settings screen; orders already
   delivered keep the split frozen at delivery. Still on no shop-facing screen.
2. **Razorpay + SMS credentials** — ⏳ client says "within a few days" (2026-08-08). Both are
   code-complete and stubbed; each is env vars and no code change. SMS is still the only thing
   that blocks a real customer login, and Razorpay is what stops any prepaid order — which is
   every gym membership. ✅ **Cloudinary landed 2026-08-08** and is in `server/.env`.
2b. ~~**Rider pay rates**~~ ✅ answered on the client call 2026-08-07: **₹25 base, first 2 km
   included, ₹8/km beyond** — a 5 km delivery pays ₹49. Recorded by `npm run config:apply`, and
   `tests/platformConfigApply.test.js` pins that ₹49 end to end, so nothing can quietly reprice
   every rider on the platform.
3. ~~**Delivery fee + tax treatment**~~ ✅ answered 2026-08-07 from `designs/Partner.png`'s own
   bill panel — `tax_percent` 5, `delivery_fee` 25, recorded by `npm run config:apply` along with
   a per-industry GST override each. ⚠️ Still open: **who collects and remits the GST**. That is
   a question for the client's CA, not for code.
4. ~~**Membership validity period**~~ ✅ answered 2026-08-07 — the shop sets price *and* duration.
   `ProductVariant.validityDays` carries it, and `voucher_validity_days` is now only the fallback
   for a variant that does not declare one. There are no invented numbers left in the codebase.
5. **Launch scale** (how many shops / riders / which district) — decides whether the rider pool
   needs any batching in v1.
6. ~~**Separate Play Store listings** for the three executive apps?~~ ✅ **Answered 2026-08-08 —
   yes, one each.** Six apps platform-wide, three codebases (HANDOFF §4). Built the same day; it
   cost config and one lookup table, and touched no screen. Outstanding: four sets of icons and
   screenshots.
7. ~~**Live "in stock" indicator** — was this promised to customers?~~ ✅ **Answered 2026-08-08 —
   yes.** Largely already delivered: `sellableQty()` is the only count that ever reaches a
   customer, the shop screen caps every stepper at it and shows "only N left" under 5. What the
   promise adds is an explicit **sold out** state (an unsellable row is currently just absent) and,
   if "live" means seconds, a faster catalog poll than 60s. See HANDOFF §7.6 for the one thing
   worth putting back to the client — a true live count publishes a shop's stock levels.
8. ~~**Subscription tiers / billing anchor**~~ ✅ **resolved and built 2026-08-09.** The anchor is
   `User.approvedAt` + 3 months (`subscription_trial_months`), the tiers are the three
   `subscription_fee_*` rows the client confirmed on 2026-08-07, and collection is a manual invoice
   plus a payment link. ⚠️ One genuinely open item is left, and it is the client's records rather
   than a decision: partners approved before approval dates were recorded have no trial start, so
   nothing bills them.

Neither #1 nor #2 stops Phase 1 any more — both are wired to config/env and default to something
visibly wrong rather than plausibly invented. They stop *launch*.

---

## 8. Recommended next action

~~Do §1 (Decimal + test runner + push field)~~ ✅ done 2026-08-06.
~~§2.1 customer auth + `protectCustomer`~~ ✅ done 2026-08-06.
~~§2.2 serviceability + ranking, §2.3 catalog/cart, §2.4 placement~~ ✅ done 2026-08-06.
~~§2.5 routing + sweeper, §2.6 shop response, §2.7 delivery~~ ✅ done 2026-08-06.
~~§2.8 money — Razorpay webhook, COD remittance, commission split, weekly settlement~~ ✅ done
2026-08-06.
~~§2.9 the four fulfilment types~~ ✅ done 2026-08-06.

~~Phase 2 — monorepo, `packages/ui`, `packages/api`, the shop role~~ ✅ done 2026-08-06.

**225 server tests green** (`cd server && npm test`) plus **10** in `packages/ui`. **Phases 1 and 2
are complete.** A shop can sign in on a phone, open its storefront, answer a 60-second offer, walk
the order to ready, correct its shelf, recount an auto-hidden SKU, redeem a membership voucher and
restock from its distributor. A distributor, manufacturer or regional partner can sign in to the
same app and see its own dashboard, order book, network and catalogue — all against the same API
the headless tests exercise.

~~Push notifications (Expo Push)~~ ✅ done 2026-08-06.
~~The three executive roles~~ ✅ done 2026-08-06 — **Phase 2 is complete.** All four business roles
ship from one codebase.

~~Polish the six undesigned screens · phone-or-email staff sign-in · MSG91~~ ✅ done 2026-08-07.
**255 server tests green**, `apps/business` bundles clean. See HANDOFF §5 (the six primitives the
polish added) and §6 (what later phases must respect).

~~Rider earnings · the confirmed numbers · variant validity · the B2B constants · the Master
config screen~~ ✅ done 2026-08-07. **299 server tests green**, `apps/business` bundles clean,
`client` builds. See HANDOFF §6 for the five things later phases must respect. In short: a rider
is now *paid* for a delivery and settled weekly like a shop; tax and the delivery fee are the
client's own figures with per-industry GST overrides; a gym sets its own membership duration; no
number in either order flow is a constant; and all of it is editable from **Master → Platform →
Settings** rather than by a developer running a script.

~~Shop-owned delivery boys — the foundation~~ ✅ done 2026-08-08. **321 server tests green**, both
app variants bundle. See §4 above and HANDOFF §6. In short: `employerShopId` partitions every
rider in two and the platform pool excludes shop-employed ones unconditionally; serviceability
asks a self-delivering shop about its **own** staff; the shop hires and releases them from the
Shop app; and RoadMate neither pays nor settles somebody else's employee. Settlement is untouched
— HANDOFF §7.8's three money questions are still the blocker for the other half.

~~Phase 3 — the Rider app~~ ✅ done 2026-08-08. **334 server tests green**, `apps/rider` and all
four business variants bundle clean. Five of six listings now exist as code. See §4 above and
HANDOFF §6 for the six things later phases must respect. In short: one app serves both kinds of
rider and the difference is three components wide; the ladder is two rungs because the enum's
middle two have no endpoints; the shift is server-owned and never optimistic; location reporting
runs only on shift and is a precondition for being given work at all; navigation hands off to
Google Maps by coordinates; and the POD photo is the one piece left out.

~~Phase 4 — the Customer app~~ ✅ done 2026-08-08. **352 server tests green**, all six builds
bundle clean. **Every app the platform ships now exists as code.** See §5 above and HANDOFF §6 for
the six things later work must respect. In short: an order names no shop until one accepts it and
the reroute trail never names one that declined; the bill is the server's arithmetic and checkout
does not attempt it; carts are plural and never merge; `useResource` became `packages/hooks`
exactly as Phase 3 said it would; tracking polls every 10 seconds and stops when the order settles;
and the two flows blocked on unmade purchases — prescription upload and online payment — say so on
screen rather than offering an affordance that cannot work.

~~File storage — the Cloudinary seam and the two flows waiting on it~~ ✅ **done 2026-08-09.**
**366 server tests green**, all six builds bundle, `client` builds. No migration and no endpoint
change — both endpoints have always taken URLs, which is exactly what that choice was for. In
short: the phone gets a **signature**, never the secret, and posts bytes straight to Cloudinary;
`UPLOAD_KINDS` is a closed table and the audience comes from the route, so a customer cannot sign
a proof-of-delivery photo; prescriptions are `authenticated` assets and are **never pruned**; POD
photos are kept `pod_photo_retention_days` (90) and `npm run prune:uploads` is what enforces it —
⚠️ **nothing schedules it yet**; a URL we did not issue is a 400 `NOT_OUR_ASSET`, and without
credentials the whole file stubs out exactly like `razorpay.js` and `sms.js`. Proof stays optional
and the camera is absent rather than disabled where storage is not configured.

~~Subscription billing + the 3-month trial~~ ✅ **done 2026-08-09.** **391 server tests green**
(25 new in `tests/subscriptionBilling.test.js`), 10 in `packages/ui`, all six builds bundle,
`client` builds. One additive migration, two new tables, nothing altered or backfilled. See
HANDOFF §7ter for the seven things later work must respect. In short: the trial clock starts at
`User.approvedAt` and a partner without one gets no subscription rather than a guessed date; there
is no stored status because trial-vs-active and past-due are both functions of the clock; the fee
is frozen onto the invoice at issue like every other price in this codebase; an unset fee bills
**nobody** rather than ₹0; `npm run billing` is a daily one-shot that is re-runnable and self-heals
a missed month; payment is a manual invoice plus a Razorpay payment link with no mandate anywhere;
and a link is issued once per invoice because two links is two ways to pay one month.

~~The live "in stock" promise~~ ✅ **done 2026-08-09.** Sold out is a state, not an absence:
`inStock` on every shelf row and offer, sold-out rows last and unbuyable, and a 15-second shop
screen. ✅ **The client's remaining question is answered (2026-08-09): keep the exact count** — so
"only 3 left" stays. `inStock` is separate from `availableQty` anyway, so the count could be
withdrawn later without touching a screen; never derive sold-out from `availableQty > 0`.

~~The merchandising layer, and the shop-location gap under it~~ ✅ **done 2026-08-09.**
**483 server tests green** (92 new), 10 in `packages/ui`, all six builds bundle, `client`
builds. One additive migration — `Banner`, `Collection`, `CollectionItem`, `Coupon.autoApply`;
nothing altered, nothing backfilled. See HANDOFF §6 for the seven things later work must
respect. In short: a shop's coordinates are now required at onboarding and repairable from
three surfaces, because a NULL-coordinate shop is invisible rather than merely unranked and
**no dashboard created a shop at all**; the hardcoded Unsplash stock photo is deleted and
product and banner artwork ride the signed-upload seam with their own retention tags; coupons
finally have an API and a screen and customers can *see* offers instead of having to know a
code; a used coupon is never deleted; `autoApply` reuses `resolveCoupon` rather than
reimplementing it, and a typed code still wins; a banner carries a window so it switches itself
off and opens exactly one thing; and a collection is curation with no money in it, whose list is
replaced as a whole because order is the content.

⚠️ **One thing this left behind, and it is a judgement call somebody should confirm:** the shop
onboarding form was put on the **Regional** dashboard, since REGIONAL is who approves shops in
`getPendingApprovals`. Field executives (`executiveType: 'LISTING'`) are the ones who really
onboard shops and still have no app and no dashboard — §4's gap, now more visible. The map
picker and all three location endpoints are independent of where the form lives, so moving it
is a re-parent, not a rewrite.

~~The client call of 2026-08-09 — the money model~~ ✅ **done.** **500 server tests green**,
all six builds bundle, `client` builds. One additive column. See HANDOFF §6. In short:
commission is **0** and subscriptions are the only platform revenue; the platform pays **every**
rider including a shop's own delivery boy, reversing 2026-08-08; §7.8a is answered, so COD taken
by a shop's boy is deducted from that shop's payout rather than collected, and a settlement may
now legitimately go negative; the dead run fee is ₹25; and **free delivery above ₹199**, where
the shop pays the rider and below which the customer does — which also fixed a latent bug where
the platform handed the delivery fee to the shop and paid the rider anyway.

⚠️ **Still true and worth re-reading before touching money:** below ₹199 the customer's flat ₹25
does not cover a rider beyond the free 2 km, so the platform loses ₹8/km there. Pinned by
`tests/platformConfigApply.test.js` so it cannot drift unnoticed. The client was shown the
figures and chose it.

**Next:**

1. ~~**File storage.**~~ ✅ **done 2026-08-09** — see above. What it leaves behind: **schedule
   `npm run prune:uploads` daily** wherever the API is deployed. It is the third scheduled thing
   (sweeper, settlement, prune) and the only one whose absence is silent.
   <details><summary>the original entry, kept for the reasoning</summary> Two flows shipped around it and can now be finished: the rider's **proof-of-delivery
   photo and signature** (`deliver()` already takes both URLs, so the app uploads first and no
   endpoint changes) and the customer's **prescription upload** (same shape). What has to be built
   is the seam itself — `src/lib/cloudinary.js` stubbing out when the keys are absent, exactly like
   `razorpay.js` and `sms.js`, plus a signed-upload endpoint, because **the API secret is
   server-only and must never become an `EXPO_PUBLIC_*` variable**: those are compiled into the APK.
   Two decisions still ride along and are worth asking now rather than after the photos accumulate:
   how long proof-of-delivery photos are kept, and that prescription uploads are stored as
   **private/authenticated** assets — medical records, not product photos.
   ~~Still waiting on the account.~~
   The last cross-cutting piece with nothing built against it (§6). ⚠️ **It turned out not to
   block Phase 3** — the Rider app shipped around it, because OTP, note, cash and earnings need no
   file. What it blocks now is narrower and still real: the **photo and signature** half of
   proof-of-delivery, and Phase 4's prescription upload. Every endpoint already takes a **URL**
   precisely to dodge this, so when storage lands the app uploads there first and **no endpoint
   changes**. Cloudinary is the pick — free at launch volume, and it resizes images in the URL,
   which S3 does not. The ask is not money, it is an **account in the client's name** plus its
   three keys. Two decisions ride along: how long proof-of-delivery photos are kept (without an
   answer they accumulate forever), and that prescription uploads must be **private/signed URLs**,
   not public ones — they are medical records, not product photos.
   </details>
2. **The five sets of store assets.** Icons, screenshots and copy for four business variants plus
   Rider plus RoadMate — six listings, and all six currently ship the same placeholder
   `assets/icon.png`. **Assets only, no code, and now the main thing between this codebase and the
   Play Store.**
   ⚠️ ~~The three rider pay rates are still 0.~~ **Stale — checked against the dev database
   2026-08-08 and all three are set** (`rider_base_fee` 25, `rider_free_km` 2, `rider_per_km_fee`
   8), so a 5 km delivery pays ₹49. There is no outstanding client question here. What *is* true:
   the rates live in `PlatformConfig` rows, not in code, so **any new environment needs
   `npm run config:apply` run once** or every rate falls back to 0 and a completed delivery pays
   nothing. Same for commission, tax and the delivery fee.
3. ~~**Master config screen**~~ ✅ done 2026-08-07, and promoted onto the critical path rather
   than left until last — every commercial answer the client gave was "set it from the dashboard
   at the end", which made this the delivery mechanism for all of them. HANDOFF §7bis.2 was
   folded in as planned.
4. ~~**Subscription + trial**~~ ✅ **done 2026-08-09** — both halves, see HANDOFF §7ter. What it
   leaves behind: **schedule `npm run billing` daily**, and decide the trial start date for the
   partners approved before `User.approvedAt` existed (they are reported as `trialStartKnown:
   false` on the Master billing screen and are currently billed nothing).
5. **Deployment.** Nothing has ever been deployed. Production Postgres, the API, and **four**
   scheduled things — the sweeper as its own long-running process, and three one-shots on cron:
   the weekly settlement, the daily `prune:uploads`, and the daily `billing`. Plus error tracking:
   there is one global handler that swallows everything (§6). ⚠️ **A new environment needs
   `npm run config:apply` run once**, or every rate falls back to 0 and a delivered order pays
   nobody anything.
6. ⛔ **Shop-delivery settlement** — still blocked on HANDOFF §7.8's three money questions (COD
   cash, the ₹25 delivery fee, the busy-boys fallback). Nothing in settlement may be guessed at:
   a wrong answer produces wrong payouts. Everything else in that feature is built.
7. ⛔ **Item-level promo pricing (the "₹1 deal")** — blocked, and it is the one merchandising
   thing left unbuilt. It needs the client's answer on **who absorbs the difference**, platform
   or shop: it changes `applyCommissionSplit()` and the weekly settlement, so a guess produces
   wrong payouts. Same category as §7.8's three. Everything around it now exists — coupons,
   auto-apply, banners and collections all shipped 2026-08-09 precisely because none of them
   touches the split.
8. **Field executives still have no app and no dashboard**, and the merchandising work made
   this more visible rather than less: they are who onboards shops, and shop onboarding now has
   a form — on the Regional dashboard, because that is where it could go. Not blocked on
   anything; it is new screens.

~~Do not start Phase 4 before Phase 3.~~ ✅ **Both are done.** The rule was "a customer app has
nowhere to send an order until a rider can collect one" — and a customer can now place an order on
one phone, a shop can accept and pack it on a second, and a rider can collect and deliver it on a
third, against the same API these tests exercise. What is left is not app work: it is two purchases
(Cloudinary, Razorpay), three unanswered money questions (HANDOFF §7.8), billing, and six sets of
store assets.

---

## 9. Out of scope (do not drift into these)

Migrating Laravel data/users/orders · rider batching & multi-pickup · surge pricing · zone
polygons · cash penalties on shops in year one · automatic recurring billing until the client
confirms · converting existing `String` role/status fields to enums.
