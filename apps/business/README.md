# RoadMate Business — one codebase, four shipped apps

**Revised 2026-08-08 (HANDOFF §4):** the client wants **six apps**, with each business role getting
its own. Four of those six come from this project, built from the same source via Expo app
variants:

| Shipped app | `APP_VARIANT` | Serves | Package id |
|---|---|---|---|
| **RoadMate Shop** | `shop` | Shop owners | `com.roadmate.shop` |
| **RoadMate Manufacturer** | `manufacturer` | Manufacturers | `com.roadmate.manufacturer` |
| **RoadMate Distributor** | `distributor` | Distributors | `com.roadmate.distributor` |
| **RoadMate Regional** | `regional` | Regional partners | `com.roadmate.regional` |

The other two are `apps/rider` (RoadMate Rider — ✅ built 2026-08-08, Phase 3) and `apps/consumer`
(RoadMate, customers — Phase 4, not started). **Six listings, three codebases.**

⚠️ **`partner` is retired.** It was the 2026-08-07 single listing for all three partner roles;
`APP_VARIANT=partner` now fails the build with a message saying why, rather than quietly producing
something. `com.roadmate.partner` was never published, and a package id cannot become three apps.

**This split touched no screen**, which is the point worth knowing before you change anything here.
The three partner roles never differed by screen — only by which endpoints return something, and
that has always been a table (`src/roles.js`). So a listing is a row in `app.config.js` plus a row
in `APP_FOR_ROLE` (`src/variant.js`), and a role is a row in `src/roles.js`. `app.config.js`
overrides only name, slug, scheme and package id, and injects the role the build serves.

**Four listings, still one `(exec)` section.** Those are different things. All three partner roles
share `app/(exec)`; each build just ships with a single role in `VARIANT.roles`, so its door admits
exactly one of them. Do not split `(exec)` into three — that would be three copies of six screens
to keep in sync, for no user-visible gain.

All four roles are built. The shop came first — it is the hinge, the only actor that touches both
order flows, and the only one whose backend had to be written. The three partner roles came second
and needed no new backend at all: they are list/detail over the same B2B endpoints the seven web
dashboards already use.

`app/index.js` is the door. It routes by role — `(shop)` or `(exec)` — but only into a section
**this build ships**; a distributor who installs RoadMate Manufacturer is told, by name, which app
to install instead — which matters more with four business listings than it did with two, since a
field executive hands out the name. The three partner roles share one section, not three: they
differ only in which endpoints return something, and that difference lives in `src/roles.js` as a
table.

## Running it

```
npm install                                        # from the repo root — workspaces
cp apps/business/.env.example apps/business/.env   # set your LAN address

npm run shop           # RoadMate Shop          (alias: npm run business)
npm run manufacturer   # RoadMate Manufacturer
npm run distributor    # RoadMate Distributor
npm run regional       # RoadMate Regional
```

Three processes, not one:

| Process | Command (repo root) | Why |
|---|---|---|
| API | `npm run server` | everything |
| **Sweeper** | `npm run sweeper` | **enforces the 60-second accept window.** Without it no offer ever expires and no reroute ever happens — the countdown on screen becomes decoration |
| App | `npm run shop` / `manufacturer` / `distributor` / `regional` | this |

`EXPO_PUBLIC_API_URL` must be the dev machine's LAN address. `localhost` resolves to the phone.

⚠️ **Before store submission:** all four variants still share `assets/icon.png`. Each needs its own
icon, screenshots and store copy — four sets, not two, since the 2026-08-08 split. Assets only, no
code change, and it is now the main thing between this codebase and the Play Store.

⚠️ **Check all four bundle**, not one. A change that breaks one breaks all four:
`npm run export:shop` / `export:manufacturer` / `export:distributor` / `export:regional`.

## Screens

### Shop

| Screen | Designed? | Notes |
|---|---|---|
| Sign in | — | **phone number or email** + password, the existing staff JWT (shared by all four roles). One field that takes either — a shop owner should not have to know which kind of credential they have before they can start typing. The keyboard is `email-address` on purpose: it carries digits *and* letters, so both halves are typeable without switching modes |
| Home | ✅ `designs/Partner.png` | greeting → open toggle → stats → quick actions, plus a live banner for waiting offers |
| Orders (offers + in progress) | ❌ | the 60-second countdown and accept/decline |
| Order detail (accepted → packing → ready) | ❌ | plus the stockout escape hatch |
| Stock | ❌ | count corrections, price, and the recount that un-hides a SKU |
| Restock | ✅ `designs/Partner.png` | the B2B catalogue, cart and order — the shop *buying* |
| Vouchers | ❌ | the NO_DELIVERY counter |
| Delivery staff | ❌ | the shop's own delivery boys, and the switch between them and RoadMate's riders. Reached from Profile, not a sixth tab |
| Profile | ✅ `designs/Partner.png` | |

The ❌ screens are built in HANDOFF §5's design language and were **polished in-house on
2026-08-07**. They are not going to the UI/UX team.

### Executive (Distributor · Manufacturer · Regional)

| Screen | Designed? | Notes |
|---|---|---|
| Home | ✅ `designs/Partner.png` | greeting → stat tiles → quick actions → recent orders. The tiles differ per role because `getOverview` returns different keys per role |
| Orders | ✅ `designs/Partner.png` | `#RM-8231 • Kannan Motors`, status pill, amount, Details ›. A distributor gets a **To fulfil / My purchases** filter, because it is on both sides |
| Order detail | ❌ | the seller's status ladder: Confirm → Dispatch → Deliver |
| Network | ❌ | pending approvals (approve/reject) + the active network. A distributor also sees each shop's outstanding/credit |
| Products | ✅ `designs/Partner.png` | the executive's *own* catalogue — the other end of the shop's Restock screen |
| Profile | ✅ `designs/Partner.png` | business, territory, and (Regional only) settled payouts |

Which tabs appear is per role, from `src/roles.js`:

| Role | Network | Products | Payouts |
|---|---|---|---|
| Distributor | ✅ (+ shop credit) | ✅ | — |
| Manufacturer | — | ✅ | — |
| Regional | ✅ | — | ✅ |

A tab is hidden when the role's endpoint returns nothing — a manufacturer falls through
`getActivePartners`' role ladder to its fail-safe empty clause, so it has no network. Hiding it is
honest; an always-empty tab is not.

### Shared by both sections

| Screen | Designed? | Notes |
|---|---|---|
| Subscription | ❌ | the free trial, the monthly fee, and every invoice. `app/subscription.js`, at the **root** rather than in `(shop)` or `(exec)` — the three billable roles span both sections and see an identical screen. Reached from Profile in both, never a tab |

## Subscriptions and the free trial

Built 2026-08-09 (HANDOFF §7ter). `src/billing.js` decides the wording; the server decides the
state.

- **The banner is quiet by default.** `billingBanner()` returns null for a partner in good
  standing, and for a trial with more than 30 days left. A "you have 89 free days" strip on day one
  is an advert, and it trains people to ignore the strip that will matter on day 83.
- **`phase` comes from the server and is never re-derived here.** It is computed from the clock
  *and* the invoices (`TRIAL` · `ACTIVE` · `PAST_DUE` · `CANCELLED`), so a screen that recomputed it
  from `trialEndsAt` alone would disagree the first time an invoice went overdue.
- **Three of the roles are billed and one is not.** A Regional partner is paid a share of the
  commission pool rather than charged, so `getBilling` answers `billable: false` and the screen says
  that rather than rendering empty. The link is shown to every role on purpose: "you aren't billed"
  is a useful answer, and one link is cheaper than another role table.
- **A blank fee is not a free one.** `feeConfigured: false` means RoadMate has not set a price for
  that role, so the partner is not invoiced at all. It renders as "Not set", never ₹0.
- **`trialStartKnown: false` is a real state, not an error.** A partner approved before RoadMate
  recorded approval dates has no date to count three months from. The screen says so plainly.
- **Money here is `formatINR`, not `formatAmount`.** Subscriptions are Decimal/fixed-2 strings on
  the server like the rest of the B2C money — unlike the B2B floats this same app shows two tabs
  away, which is exactly why the two formatters exist.
- **Payment is a link, never a charge.** The app asks the server for a Razorpay payment link and
  opens it. With no credentials the server returns `live: false` and the app **says so** rather
  than opening a stub URL — the same rule the Customer app applies to prepaid checkout.

## Things that will bite if you change them

- **A shop's own delivery boy belongs to that shop, never to the pool.** `usesOwnRiders` on the
  storefront is the switch; `employerShopId` on the rider is which side he is on. The screen's
  "Remove" sets `isActive: false` and **never** clears `employerShopId` — that would move an
  ex-employee into the platform pool, where he would start being offered rival shops' orders.
- **A shop that switches to its own staff with nobody on shift disappears from customers.** That is
  the truth, not a bug: serviceability asks a self-delivering shop about *its own* riders. The
  screen carries a red banner saying so, because the alternative is a shop wondering why the
  orders stopped.
- **Accept is a claim, not an update.** A 409 from `acceptOffer` means the sweeper already rerouted
  the order. The UI says "this order moved on" and refreshes. It must never retry: there is nothing
  left to win.
- **B2C money is a fixed-2 string** and is formatted, added and multiplied as one (`@roadmate/ui`'s
  `formatINR` / `addMoney` / `mulMoney`, integer paise under the hood). Never `parseFloat`.
  B2B money is a `Float` on purpose and goes through `formatAmount`.
- **`commission_percent` is on no screen.** It still defaults to the undocumented 15 from
  `orderController.js:196`; the client has never confirmed it. Settled amounts are real and could be
  shown one day — a live percentage cannot (PLAN §7.1).
- **Two auth guards, told apart by JWT audience.** This app holds only the staff token (no `aud`).
  Customer tokens carry `aud: roadmate-customer` and are rejected by `protect`.
- **Polling, not push.** Every endpoint is pollable and `src/config.js` sets the intervals. Push
  (Expo Push) is a separate job — see PLAN §6.
- **`useResource` lives in `@roadmate/hooks`** as of Phase 4, not in `src/`. It
  had been copied into `apps/rider` with a note that a third copy would flip the
  trade; the Customer app was that third copy. One file now, three apps — so a
  change here is a change to all of them, and all three must still bundle.
- **Every mutating tap goes through `useResource`'s `withPause`.** Without it a poll landing
  mid-action re-renders the screen from pre-action data and the user watches their own tap get
  undone. The stock sheet's writes were the one exception; that was fixed in the polish pass, not
  because anyone had been bitten (the stock poll is 60s) but because "slow enough to get away
  with" is not the rule.
- **No list renders a blank first paint, and no screen swallows a failing poll.** `Skeleton*`
  distinguishes "loading" from "genuinely empty"; `Banner` + `connectionMessage` surface an error
  that `useResource` is deliberately keeping the last good data through. A silently stale offers
  screen is the worst failure this app has.
- **The exec status ladder is drawn, and is display-only.** `LADDER_STEPS` in `src/tradeOrder.js`
  is derived from `LADDER` so the picture and the buttons cannot disagree. **No rung may ever get
  an `onPress`** — a row of tappable statuses is exactly what `updateOrderStatus` cannot survive.
- **`updateOrderStatus` is not idempotent.** Setting `Approved` or `Dispatched` decrements
  `Product.stockLevel` every time it is called, with no guard. That is why the executive order
  detail offers exactly **one** next rung of a fixed ladder and never a status picker — and why the
  button is behind a confirmation. `Delivered` additionally writes the commission payouts.
- **The two order flows share method names, so `executiveApi` renamed its own.** `listOrders` and
  `setOrderStatus` on `shopApi` are the *consumer* inbox; the trade equivalents are
  `listTradeOrders` / `setTradeOrderStatus`. Both surfaces are merged into one client in
  `session.js` — a collision there would silently swap a shop's inbox for its purchase history.

## Layout

```
app.config.js             the two variants — name, slug, package id, roles
app/                      expo-router routes
  _layout.js              session provider
  index.js                the door — routes by role, and only into
                          sections THIS build ships
  sign-in.js
  (shop)/
    _layout.js            the five tabs
    index.js              home
    orders.js             offers + in progress
    order/[orderId].js    lifecycle
    stock.js  restock.js  vouchers.js  profile.js
    delivery.js           the shop's own delivery staff + the mode switch
  (exec)/
    _layout.js            the tabs, minus the ones this role has no data for
    index.js              home
    orders.js             the trade order book
    order/[orderId].js    the seller's status ladder
    network.js  products.js  profile.js
src/
  session.js              token in SecureStore, user, the API client
  variant.js              which app this build is, and which roles it serves
  roles.js                what each partner role is: stats, tabs, labels
  tradeOrder.js           counterparty, seller check, the status ladder
  config.js               API URL and poll intervals
```

Shared code lives in `packages/ui` (tokens, primitives, money), `packages/api` (the HTTP client
and every endpoint the shop touches) and `packages/hooks` (`useResource`). All three ship
uncompiled source; `metro.config.js` is what makes
that work in the monorepo.
