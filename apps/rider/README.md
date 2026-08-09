# RoadMate Rider — one app, two kinds of rider

**Phase 3.** The last-mile app: shift on, collect from the shop, deliver against
the customer's OTP, hand the cash in.

| Shipped app | Serves | Package id |
|---|---|---|
| **RoadMate Rider** | RoadMate delivery partners **and** shops' own delivery boys | `com.roadmate.rider` |

One of six listings, from three codebases. Unlike `apps/business` there is **no
`APP_VARIANT` here and no `app.config.js`** — this is a single listing, so
`app.json` is the whole configuration.

## The one thing to understand before changing anything

**Two kinds of rider install this app, and they see the same screens.**

A shop either uses RoadMate's delivery partners or its own delivery boys
(HANDOFF §3). Either way the rider signs in here, goes on shift, is tracked, and
walks an identical pickup → OTP → delivered flow. The difference is **ownership
and money, not screens**, which is why it is one codebase and one listing rather
than two.

That difference surfaces in exactly three places, all driven by
`employerShopId` on `GET /api/auth/me`:

| Where | What differs |
|---|---|
| `app/(rider)/_layout.js` | the **Earnings tab is not rendered** for a shop's employee |
| `app/(rider)/profile.js` | says **who does pay him**, by name |
| `app/(rider)/index.js` | "Deliveries in hand" replaces "Earned today" |

Nothing else in the app asks who employs the rider — and nothing else should.
The backend has already partitioned the pool (`freeRidersNear`,
`hasRiderCoverage`, and the assignment claim all filter on `employerShopId`), so
**any job that reaches this app is one this rider is allowed to have**. A client
check would be a second, weaker copy of a rule the database already enforces.

## Running it

```
npm install                                     # from the repo root — workspaces
cp apps/rider/.env.example apps/rider/.env      # set your LAN address

npm run rider                                   # from the repo root
```

Three processes, not one:

| Process | Command (repo root) | Why |
|---|---|---|
| API | `npm run server` | everything |
| **Sweeper** | `npm run sweeper` | enforces the 60-second accept window. Without it no offer expires, **no shop ever accepts, and no delivery job is ever created** — the job list stays empty and nothing in this app is testable |
| App | `npm run rider` | this |

`EXPO_PUBLIC_API_URL` must be the dev machine's LAN address. `localhost`
resolves to the phone.

**A rider never polls for work.** Jobs are assigned server-side when the *shop*
marks an order READY. If the job list is empty, the shop half of the pipeline is
where to look — run `apps/business` as the shop and walk an order to READY.

⚠️ **Before store submission:** this app ships `apps/business`'s placeholder
`assets/icon.png`. It needs its own icon, screenshots and store copy — assets
only, no code.

## Screens

| Screen | Designed? | Notes |
|---|---|---|
| Sign in | — | phone number **or** email + password, the existing staff JWT. The hint leads with the phone number, because a rider added from the Shop app's roster has **no email address at all** |
| Shift | ❌ | the switch, the current delivery, today's numbers. The switch is the loudest thing in the app |
| Jobs | ❌ | live jobs, then history |
| Delivery (job detail) | ❌ | collect → OTP → delivered, plus the dead-run escape hatch |
| Earnings | ❌ | today, unsettled, settled, and the rates. **Hidden for a shop's own boy** |
| Cash | ❌ | COD in hand and the hand-in |
| Profile | ❌ | who you deliver for, and the way out |

None of these are in `designs/` — the Figma exports cover the B2B half and the
customer half. They are built in HANDOFF §5's design language out of
`@roadmate/ui`, the same way the six undesigned Shop screens were.

## Things that will bite if you change them

- **The ladder is two rungs, not four.** `DeliveryJobStatus` has
  `EN_ROUTE_PICKUP` and `AT_PICKUP`, and **no endpoint sets either**. `pickUp()`
  accepts a job in any of `ASSIGNED` / `EN_ROUTE_PICKUP` / `AT_PICKUP` and moves
  it straight to `EN_ROUTE_DROP`. `src/job.js` draws the ladder that actually
  exists. A button whose endpoint does not exist fails in a rider's hand at a
  shop counter.
- **The OTP is the delivery, not a formality.** It is the only thing separating
  "delivered" from "marked delivered"; a wrong code is a 422 and the order does
  not move. There is no skip and no override in the app because there is none in
  the API. A customer with no code has not received their order — that is a dead
  run.
- **Delivering is the moment money moves.** One call drops the shop's stock,
  freezes the commission split, freezes the rider's fee, and records COD cash
  against the rider. That is why the button names the cash before it is pressed.
- **Nothing on the money screens is computed here.** Every figure is a frozen
  `DeliveryJob.riderEarning` column or a `RiderSettlement` row. B2C money is a
  fixed-2 **string** and is formatted as one (`formatINR`) — never `parseFloat`.
- **The rates *are* shown, unlike `commission_percent`.** A rider is entitled to
  know how their own pay is worked out. A platform's cut is a different thing.
- **The shift is server-owned and never optimistic.** Going off shift while
  carrying a job is a 409, and the local flag is only ever set from a response
  that succeeded. Showing "off shift" to a rider the platform is still assigning
  orders to is the worst lie this app could tell.
- **Location is a precondition, not telemetry.** `freeRidersNear()` and
  `hasRiderCoverage()` read `lastLat`/`lastLng`. A rider whose position goes
  stale silently stops being offered work *and* can take the shops around them
  out of serviceability. Reporting runs **only** while on shift, foreground
  permission only, and a failed report is dropped rather than queued — each
  report overwrites the last, so a stale fix has no value.
- **`EXECUTIVE` is two different jobs.** `executiveType: 'DELIVERY'` is a rider;
  `'LISTING'` is a field executive who onboards shops and has no app at all. The
  door checks both, because the role string alone would sign a field executive
  in to a job list that stays empty forever.
- **Every mutating tap goes through `useResource`'s `withPause`.** Without it a
  10-second poll landing mid-action re-renders the screen from pre-action data
  and the rider watches their own tap get undone.
- **`useResource` is now `@roadmate/hooks`**, not a copy. It was duplicated
  between this app and the Business app on the understanding that a third copy
  would flip the trade; Phase 4's Customer app was that third copy, so the two
  identical files became one package. A fix now lands everywhere at once — and
  breaks everywhere at once, so check all three apps bundle.

## Proof of delivery

Built 2026-08-09. `src/proof.js` and `src/SignaturePad.js`; the capture lives on
the job card, above the dead-run button, and the two URLs ride along with the
OTP on the one `deliver()` call.

- **The phone never holds the Cloudinary secret.** It asks
  `POST /api/rider/uploads/signature` for a one-shot authorisation to upload one
  asset of one kind, then posts the bytes **straight to Cloudinary**. An
  `EXPO_PUBLIC_CLOUDINARY_API_SECRET` would be compiled into the APK and is
  enough to delete the client's whole account, so there is no such variable and
  there must never be one.
- **The section is absent, not disabled, where storage is not configured.**
  `useUploadsAvailable` probes once when the screen opens; a failed probe is
  "no". Same rule as before the feature existed — the difference is only that
  the answer is now usually yes.
- **Proof is optional and must stay optional.** The OTP is the delivery. A
  refused camera permission, a full phone or a basement must never be what makes
  an order undeliverable, and every upload failure message ends by saying the
  delivery can still be completed.
- **The signature is vector, not a screenshot.** Strokes are captured as points
  and uploaded as an SVG built from them (`signatureToDataUri`). Rasterising a
  view would mean `react-native-svg` **and** `react-native-view-shot` in all six
  builds, plus a development build, to produce something blurrier.
- **Photos are kept 90 days** (`pod_photo_retention_days`), deleted by
  `npm run prune:uploads` on the server. ⚠️ Nothing schedules that job yet.

## What is not built, and why

- ✅ **Proof-of-delivery photo and signature** — built 2026-08-09, when
  Cloudinary landed. `deliver()` did not change: it has always taken `photoUrl`
  and `signatureUrl`. See "Proof of delivery" below.
- ⛔ **Anything touching settlement for a shop-delivered order** — HANDOFF §7.8's
  three money questions. Visible consequence: a shop's own boy's COD cash is
  still recorded as platform-collected, so the Cash screen counts it. The screen
  says so rather than inventing the answer.
- **`TRADE_ROUTE`** — the designed multi-drop barcode flow. `LAST_MILE` only
  until there is B2B volume to justify it.
- **Push notifications.** `registerDevice` is on the client and the backend
  endpoint exists; wiring an Expo push token needs a development build on a real
  device. The job list polls every 10s, so nothing is blocked on it.

## Layout

```
app.json                  the whole configuration — one listing, no variants
app/
  _layout.js              session provider
  index.js                the door — riders in, everyone else told which app is theirs
  sign-in.js
  (rider)/
    _layout.js            four tabs, or three for a shop's own delivery boy
    index.js              shift
    jobs.js               live jobs, then history
    job/[jobId].js        collect → OTP → delivered
    earnings.js  cash.js  profile.js
src/
  session.js              token in SecureStore, the user, the shift, the API client
  config.js               API URL, poll intervals, the location interval
  useLocationReporting.js where the rider is, while on shift only
  job.js                  the ladder, the labels, the maps and tel links
  proof.js                the photo, the signature upload, and whether either is possible
  SignaturePad.js         a finger, captured as points and uploaded as SVG
```

Shared code lives in `packages/ui` (tokens, primitives, money), `packages/api`
(`riderApi` — every endpoint this app touches) and `packages/hooks`
(`useResource`). All three ship uncompiled source; `metro.config.js` is what makes that work in the monorepo.

The app↔API contract is pinned by **`server/tests/riderApp.test.js`** — 13 tests
asserting the exact field names these screens dereference. Bundling proves the
imports resolve; that file is what proves `job.pickup.name` exists.
