# RoadMate — the customer app

**Phase 4.** The sixth of six listings and the third codebase: find a shop that
delivers to you, fill a cart, pay or promise cash, and watch the order climb.

| Shipped app | Serves | Package id |
|---|---|---|
| **RoadMate** | Customers | `com.roadmate.customer` |

One listing. Unlike `apps/business` there is **no `APP_VARIANT` and no
`app.config.js`** — seven industries are a switcher inside the app, not seven
builds — so `app.json` is the whole configuration.

## The two things to understand before changing anything

**1. An order is not bound to a shop until one accepts it.** `placeOrder`
returns `order.shop === null` and a separate `firstCandidateShop`, which is only
the shop whose shelf is holding the reservation. If that shop lets the
60-second window lapse, the sweeper reroutes to the next one and nothing about
the order changes except its `attempts` array. Every screen that names a shop
reads `order.shop` and renders "finding you a shop" while it is null. Anything
that treated `firstCandidateShop` as the seller would name the wrong shop on
roughly the fraction of orders that time out — which is the fraction nobody can
predict.

**2. A cart never spans shops.** `GET /api/customer/cart` returns *carts*,
plural — adding from a second shop opens a second one rather than moving the
first. That is the honest model (two shops is two deliveries, two accept
windows, two riders) and the Cart tab exists to make it visible rather than
surprising. There is no "merge carts" and there must never be one.

## Running it

```
npm install                                        # from the repo root — workspaces
cp apps/consumer/.env.example apps/consumer/.env   # set your LAN address

npm run consumer                                   # from the repo root
```

Three processes, not one:

| Process | Command (repo root) | Why |
|---|---|---|
| API | `npm run server` | everything |
| **Sweeper** | `npm run sweeper` | **enforces the 60-second accept window.** Without it an order placed here sits at ROUTING forever: no offer expires, no shop is asked twice, nothing reaches a rider, and the tracking screen says "finding you a shop" until the end of time |
| App | `npm run consumer` | this |

`EXPO_PUBLIC_API_URL` must be the dev machine's LAN address. `localhost`
resolves to the phone.

**To watch an order all the way through you need three apps running**: this one
places it, `apps/business` (as the shop) accepts and packs it, and `apps/rider`
collects and delivers it. That is not a testing inconvenience — it is the
product.

⚠️ **Before store submission:** this app ships `apps/business`'s placeholder
`assets/icon.png`, as `apps/rider` does. It needs its own icon, screenshots and
store copy — assets only, no code.

## Screens

| Screen | Designed? | Notes |
|---|---|---|
| Sign in | ❌ | phone + 6-digit OTP. No password — `Customer` has no password column. Outside production the code is shown in a labelled banner, because SMS is stubbed until MSG91's credentials land |
| Home | ❌ | deliver-to header, industry chips, and the serviceable shops. The whole screen is one `GET /api/customer/serviceable` |
| Search | ❌ | browse **by product** across every serviceable shop, cheapest offer first |
| Shop | ❌ | one shop's shelf, plus the configure-and-add sheet (add-ons, quantity) |
| Cart | ❌ | every open cart, one card per shop |
| Checkout | ❌ | address, payment method, offer code, instructions |
| Order | ❌ | the live ladder, reroutes, cancellations, the bill, and the membership code |
| Orders | ❌ | live first, then history |
| Addresses | ❌ | the pin and the text |
| Profile | ❌ | who you are and the way out |

None of these are in `designs/` — the Figma exports cover the B2B half and only
part of the customer half. They are built in HANDOFF §5's design language out of
`@roadmate/ui`, the same way the Shop and Rider screens were.

## Things that will bite if you change them

- **The bill is the server's arithmetic, not the app's.** Tax is a per-industry
  `PlatformConfig` row, the delivery fee is another, and a coupon is resolved
  server-side against limits this app cannot see. Checkout therefore shows the
  cart's **subtotal** and says the rest is added when the order is placed. An
  "estimated total" here would be a second answer to a question that already has
  one, and the two would disagree the first time the client changed a rate from
  the Master settings screen.
- **B2C money is a fixed-2 string** and is formatted, added and multiplied as
  one (`formatINR` / `addMoney` / `mulMoney`, integer paise under the hood).
  Never `parseFloat`. The 28 `Decimal` columns on the server exist to prevent
  exactly the error a `+` here would reintroduce.
- **Nothing in a cart is reserved.** Reservation happens once, atomically, at
  placement. A cart that priced fine can still fail at checkout, and a 409 there
  names the product that sold out. That is not a retry — the cart has to change
  first.
- **Every failure at checkout is a sentence, not a status.** `NO_RIDER`,
  `NOT_SERVICEABLE`, `PREPAID_REQUIRED` and a 409 each have their own wording in
  `readPlacementError`. Collapsing them into "something went wrong" throws away
  the only thing the customer can act on.
- **Serviceability has two distinct nos.** `NO_SHOP` is "not here yet";
  `NO_RIDER` is "come back shortly" — and since 2026-08-08 it also covers a
  self-delivering shop whose own delivery boys are off shift. Never merge them.
- **Tracking polls every 10 seconds and stops when the order settles.** Sockets
  are the upgrade path *if this visibly fails* (PLAN §5), deliberately not
  before. A delivered order will never change again and the screen stops asking.
- **The place is global state.** `src/place.js` owns the address, the industry
  and the fallback device fix, because four screens compute their requests from
  the same two values. Two screens holding two copies is how somebody browses
  against their office and checks out to their home.
- **The address is its coordinates.** The server refuses a lat/lng-less address
  and the rider navigates by those numbers rather than the typed street, so the
  form will not save without a fix.
- **Sold out is a state, not an absence.** Since 2026-08-09 the shelf includes
  rows the shop has run out of, carrying `inStock: false` — they sort last, are
  dimmed, and their sheet offers no stepper and no Add button. Dropping them, as
  the API used to, reads as "this shop doesn't stock it", which is a different
  claim. What *is* still absent: a row the shop switched off or that three
  stockouts auto-hid, because the shop is not vouching for that count at all.
  ⚠️ Render the state from `item.inStock`, never from `availableQty > 0` — the
  count may stop being published (HANDOFF §7.6) and the boolean will not.
- **The shop screen polls every 15 seconds**, browse-by-product every 60. That
  asymmetry is deliberate: the shop screen is where a stepper gets tapped, and
  the product search fans out across every serviceable shop.
- **Every mutating tap goes through `useResource`'s `withPause`.** Without it a
  poll landing mid-action re-renders the screen from pre-action data and the
  customer watches their own tap get undone.

## What is not built, and why

- ✅ **Prescription upload** — built 2026-08-09, when Cloudinary landed. It is on
  the **order** screen, not checkout, because the endpoint attaches a
  prescription to an order and there is no order until checkout succeeds;
  checkout says so first, so the camera prompt is expected. `src/prescription.js`.
  Three things it keeps: the image is uploaded straight to Cloudinary with a
  server-issued signature (the API secret never reaches the app); it is stored
  as a **private/authenticated** asset because it is a medical record, which the
  server bakes into the signature so this app could not make it public; and
  **uploading is not approving** — the order stays at PLACED and no shop sees it
  until a verifier approves the image, which the screen says. The camera is not
  rendered at all where the server has no storage configured.
- ⛔ **Online payment.** Razorpay is code-complete on the server and stubs out
  without its three env vars. With no `EXPO_PUBLIC_RAZORPAY_KEY_ID` the app
  offers **cash on delivery only** and says why, rather than walking somebody
  through a payment nobody can settle. ⚠️ Consequence: **gym memberships cannot
  be bought at all**, because `NO_DELIVERY` is PREPAID-only on the server — cash
  at the gym's own counter is money the platform never holds but would still
  book commission on. The home screen says so before the customer fills a cart.
- **A QR image for a membership.** The code is rendered large and selectable
  instead. The shop's own app redeems by **looking a code up**
  (`GET /api/shop/vouchers/:code`) and has no scanner, so a QR would be
  decoration implying a flow that does not exist. `voucher.qrPayload` is on the
  record for when one does.
- **A draggable map pin.** That needs `react-native-maps` and a Google Maps key
  nobody has bought, and the platform already hands off to Google Maps rather
  than embedding one. The device's own fix is the pin, reverse geocoding
  prefills the text, and the fix's accuracy is shown rather than hidden.
- **Order cancellation by the customer.** `cancelPlacedOrder()` exists on the
  server but no customer-facing route does, and inventing one would mean
  deciding when cancelling is still allowed — a commercial question, not a
  technical one.
- **Push notifications.** `registerDevice` is on the client and the backend
  endpoint exists; wiring an Expo push token needs a development build on a real
  device. Tracking polls, so nothing is blocked on it.

## Layout

```
app.json                  the whole configuration — one listing, no variants
app/
  _layout.js              session, then place
  index.js                the door — signed in or not, and nothing else to decide
  sign-in.js              phone, then code
  (tabs)/
    _layout.js            five tabs, none of them conditional
    index.js              home — where, what kind, and who can serve you
    search.js             browse by product
    cart.js               every open cart, one per shop
    orders.js             live, then history
    profile.js
  shop/[shopId].js        one shop's shelf + the add sheet
  checkout.js             address, payment, offer, instructions
  order/[orderId].js      the live ladder, the bill, the membership code
  addresses.js            the pin and the text
src/
  session.js              customer token in SecureStore, the customer, the API client
  place.js                where the order is going, and what kind of shopping
  order.js                the ladder, the wording, the blocked-reason reading
  prescription.js         the pharmacy camera, and whether there is anywhere to upload to
  config.js               API URL, poll intervals, whether prepaid exists
```

Shared code lives in `packages/ui` (tokens, primitives, money),
`packages/api` (`customerApi` — every endpoint this app touches) and
`packages/hooks` (`useResource`, which became a package in this phase — see its
header). All three ship uncompiled source; `metro.config.js` is what makes that
work in the monorepo.

The app↔API contract is pinned by **`server/tests/consumerApp.test.js`** — 18
tests asserting the exact field names these screens dereference. Bundling proves
the imports resolve; that file is what proves `item.availableQty` exists.

## Builds (`eas.json`)

⚠️ **This reasoning used to live in a `_comment` key inside `eas.json`. It does
not any more:** `eas-cli` validates that file against a strict schema and refuses
an unknown top-level key outright — `eas.json is not valid. - "_comment" is not
allowed`, and the build never starts. JSON has no comments, so the explanation
lives here instead. Do not put it back.

**Why a dev build exists at all.** This project is on Expo SDK 57, and the Expo
Go published on the app stores only ever supports the current released SDK —
which is why both an Android and an iPhone refuse it with "requires a newer
version of Expo Go". The fix is a development build: your own Expo Go, built from
this project, supporting exactly the SDK and native modules this app uses. It was
needed regardless — push notifications cannot be finished in Expo Go, and a store
release is a production build, never Expo Go.

| Profile | What it is |
|---|---|
| `development` | Your own dev client. Install the APK once, then run `npm run consumer` and it connects exactly like Expo Go did. Rebuild only when a **native** dependency changes; JavaScript reloads instantly over the network. |
| `preview` | A standalone APK to hand somebody for testing. No dev menu, no Metro — it runs on its own like a real install. |
| `production` | The store build (AAB for Play). |

```
eas login            # once, a free Expo account
npm run build:dev    # ~15-20 min in the cloud, ends with a QR code
```

⚠️ **EAS uploads what git tracks.** Uncommitted files are not sent to the build
server, so commit before building or the build fails on missing files.

⚠️ **`.env` is gitignored (`*.env`), so it never reaches the build server.** That
is fine for `development`, where Metro serves the JavaScript from your machine
and reads `.env` locally. It is **not** fine for `preview` or `production`, which
bundle on EAS: there `EXPO_PUBLIC_API_URL` would be undefined and the app would
point at nothing. Set it as an EAS environment variable, or inline it in the
profile, before building either of those.
