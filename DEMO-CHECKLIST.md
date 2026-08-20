# RoadMate — Demo Cheat Sheet

Everything you need to log into all six apps and prove each one actually works.
Keep this open on a laptop while the phones do the work.

---

## Before you touch a phone

The API and the **sweeper** must both be running — the 60-second accept window is
enforced by the sweeper process, not the API. Without it no offer ever expires and
nothing reroutes.

```
npm run server
npm run sweeper        # second terminal, don't skip this
```

Seeding, in this order (first time only):

```
npm run prisma:seed --prefix server
npm run demo:geo --prefix server -- 9.9816 76.2999 Kochi   # your own lat/lng if testing on a real phone
npm run demo:storefront --prefix server
npm run demo:bookings --prefix server
npm run demo:geo --prefix server -- 9.9816 76.2999 Kochi   # again, so the main shop stocks the new catalogue
```

The world is Kerala — **Kochi** and **Kozhikode**, 180 km apart on purpose. Pass
your own coordinates to `demo:geo` or the apps will look empty where you're
standing.

---

## Logins

Password for every email account: **`password123`**

| App | Email | Phone | Who they are |
|---|---|---|---|
| RoadMate Shop | `shop@roadmate.com` | 9876510008 | Mohammad Ali — **Ravipuram Auto Garage**, Kochi, Automobile |
| RoadMate Distributor | `distributor@roadmate.com` | 9876510007 | — |
| RoadMate Manufacturer | `manufacturer@roadmate.com` | 9876510006 | — |
| RoadMate Regional | `regional@roadmate.com` | 9876510005 | — |

**Riders** — phone only, no password:

| Name | Phone |
|---|---|
| Basheer Koya | 9876500011 |
| Prajeesh Nair | 9876500022 |
| Sooraj Menon | 9876500033 |

**Customers** — any mobile number at all. A new number becomes a new customer on
the spot, which is the best way to show the first-run experience.

> **The OTP is printed on the sign-in screen.** SMS is paused (expired DLT
> registration), so the code is echoed back and labelled on screen. Type it in.
> Demo setting only.

The 7 web dashboards are the same emails + `password123` at
`npm run client` → http://localhost:5173 (`master@`, `state@`, `indstate@`,
`district@`, `regional@`, `manufacturer@`, `distributor@`).

---

## Run 1 — the customer order (Customer + Shop + Rider)

Three phones if you have them. **Order from Ravipuram Auto Garage specifically** —
the first offer always goes to the shop whose cart it is, so that's what makes
`shop@roadmate.com`'s app light up rather than some demo storefront.

**Set up:** Rider app → sign in as **Basheer Koya (9876500011)** → **Go on shift**.
Nothing gets delivered without a rider on shift. That's a real rule.

| # | Customer app | Watch elsewhere |
|---|---|---|
| 1 | Sign in with any number, add an address (try **Search for it** — "Kakkanad, Kochi") | — |
| 2 | **Automobile** → **Ravipuram Auto Garage** → add e.g. *Shell Advance 10W-40* or *TVS Chain Lube* | Stock checked live against that shelf |
| 3 | Checkout → **Cash on delivery** → Place order | — |
| 4 | *Finding a shop* | **Shop app: offer card + 60-second countdown** ← the accept screen |
| 5 | — | Shop taps **Accept** |
| 6 | *Being prepared* | Shop taps **Ready** |
| 7 | *Rider on the way* | **Rider app: the job appears in Jobs** |
| 8 | — | Rider opens it: *On the way to pickup* → *Collected* → *On the way to you* |
| 9 | A **4-digit code** shows | Rider asks for it at the door and types it in |
| 10 | **Delivered** | Shop's stock drops, rider's earnings go up |

**Then show the failure.** Place a second order and let the 60 seconds run out
instead of accepting. The order doesn't fail — it's silently offered to the next
shop and the customer sees nothing. That's the most important behaviour in the
platform.

> Riders don't accept or reject — jobs are assigned to the nearest one on shift.
> The only accept/reject screen is the Shop app's.

**Shortcut:** no second phone? `npm run demo:offer --prefix server` drops a live
60-second offer straight into the Shop app's inbox. Real reservation, real expiry.

---

## Run 2 — ordering from a distributor (Shop → Distributor)

Shop app → **Restock** → the automobile catalogue.

Order **Premium Alloy Wheels (₹36,500)** or **Synthetic Engine Oil 5W-40
(₹3,200)** — the distributor-priced ones. The seller is whoever owns the product,
so these land in `distributor@roadmate.com`'s **Orders**, under *needs dispatch*.
Fulfil it there and the shop's shelf goes up — the same shelf customer orders
draw down.

## Run 3 — ordering from a manufacturer (Shop → Manufacturer)

Same Restock screen, but order **Ceramic Disc Brake Pads (₹1,850)**. Only the
manufacturer sells that one, so it goes to `manufacturer@roadmate.com` instead.
Same screen, different app receives it — that's the point worth pointing at.

A basket spanning both becomes **two separate trade orders**, one per seller.
Worth doing once, deliberately.

## Run 4 — the Regional app

Sign in as `regional@roadmate.com`. Home shows **Needs you**: partners waiting for
approval and orders to dispatch. Approve one, then open **Network** to see the
partners in the area and what it earned.

---

## Quick feature checklist

| App | What proves it works |
|---|---|
| **RoadMate** (customer) | OTP sign-in on a fresh number · address by GPS *and* by type-ahead search, pin confirmed on a map · industry tiles → real storefronts · cart, COD checkout · live tracking to the 4-digit code |
| **RoadMate Shop** | 60-second offer + Accept · Ready · Stock · Restock (Runs 2 & 3) · Redeem voucher |
| **RoadMate Rider** | Go on shift · job appears · pickup → collected → delivered with code · Earnings · Cash owed · Report a dead run |
| **RoadMate Distributor** | Receives Run 2 · dispatches it · own product list |
| **RoadMate Manufacturer** | Receives Run 3 · dispatches it · Network |
| **RoadMate Regional** | Approvals queue · area revenue · Network |

---

## Won't work today, and it isn't a bug

- **Online payment (card/UPI)** needs live Razorpay keys. COD works fully.
- **Gym memberships and turf bookings** are prepaid-only, so they need the same
  keys. The venues, calendars and priced evening slots are all seeded and visible
  — they just can't be paid for yet.
- **SMS OTP** — code is on screen instead, as above.
- **Address search and the map** need Google Maps keys — two of them, for two
  different reasons. See [docs/ADDRESS-SEARCH-SETUP.md](docs/ADDRESS-SEARCH-SETUP.md).
  Without them nothing breaks: search falls back to the phone's own geocoder and
  the map area renders blank, which is the behaviour from before the feature
  existed. With them, the customer can add an address anywhere in India and drag
  the pin onto the actual door.
  **The map is a native module, so it needs a fresh APK** — a JS reload cannot
  deliver it, and an older install will keep showing the old screen.
- **First screen after a quiet spell** takes ~50s if you're on the Render demo
  server. It sleeps. Pull to refresh once.

Everyone shares one demo world, so two people signed in as the same shop see the
same orders. Anything can be reset by re-running the seed commands at the top.
