# RoadMate — Demo Guide

Six apps, one platform. This explains what each app is for, how to sign in, and
what happens between a customer tapping **Place order** and a delivery partner
knocking on their door.

Written for someone seeing RoadMate for the first time. No technical background
assumed.

---

## 1. What RoadMate is

RoadMate is **one platform carrying two kinds of order**, and they meet at the
shop.

```
  MANUFACTURER  →  DISTRIBUTOR  →  SHOP  →  CUSTOMER
  └────────── business orders ────────┘     └ customer orders ┘
```

- **The business half (B2B).** A shop buys stock from a distributor; a
  distributor buys from a manufacturer. Regional partners oversee an area and
  earn a share.
- **The customer half (B2C).** Somebody orders from their phone, a nearby shop
  packs it, and a delivery partner brings it.

The **shop is the hinge**. It buys wholesale and sells retail from *the same
shelf* — one stock count, which business orders add to and customer orders take
from. That is the single idea the whole platform is built around.

Seven industries run on it from day one: automobile, grocery, restaurant,
fashion, electronics, pharmacy, and gym memberships.

---

## 2. The six apps

| App | Who uses it | What they do in it |
|---|---|---|
| **RoadMate** | Customers | Browse shops and products, order, track delivery |
| **RoadMate Shop** | Shop owners | Accept orders, manage stock, restock from distributors |
| **RoadMate Rider** | Delivery partners | Go on shift, collect, deliver, see earnings |
| **RoadMate Distributor** | Distributors | Fulfil shop orders, order from manufacturers |
| **RoadMate Manufacturer** | Manufacturers | Fulfil distributor orders, see their network |
| **RoadMate Regional** | Regional partners | Oversee an area, approve partners, see revenue |

All six carry the same RoadMate mark. Tell them apart by the small badge under
the logo — a shopfront, a scooter, a lorry, a factory, a map pin — and by the
name under the icon.

> There are also **7 web dashboards** (Master, State, Industry-State, District,
> Regional, Manufacturer, Distributor) used from a browser rather than a phone.
> They are not part of this app demo.

---

## 3. Signing in

**Customers and delivery partners** sign in with a **phone number and a code** —
no password.

**Shops, distributors, manufacturers and regional partners** can use *either*
an email and password, *or* their phone number and a code.

> **The code is shown on screen.** Text-message delivery is paused while the
> client's SMS registration is renewed, so instead of arriving by SMS the code is
> printed on the sign-in screen, clearly labelled. Type it in the box below it.
> This is a demo setting and comes off before real customers.

### Demo logins

Password for every account below: **`password123`**

| App | Email | Phone |
|---|---|---|
| RoadMate Shop | `shop@roadmate.com` | 9876510008 |
| RoadMate Distributor | `distributor@roadmate.com` | 9876510007 |
| RoadMate Manufacturer | `manufacturer@roadmate.com` | 9876510006 |
| RoadMate Regional | `regional@roadmate.com` | 9876510005 |

**Delivery partners** (phone + code only — riders have no password at all):

| Name | Phone |
|---|---|
| Basheer Koya | 9876500011 |
| Prajeesh Nair | 9876500022 |
| Sooraj Menon | 9876500033 |

**Customers** — use *any* mobile number. A number that has not been seen before
becomes a new customer the first time it signs in, exactly as it would in
production. That is the easiest way to see the app as a first-time user.

The demo world is set in **Kerala**, across **Kochi** and **Kozhikode** — two
districts 180 km apart, on purpose, so that "which shop is nearest" is a real
question and not a rounding error.

---

## 4. Try this: one order, end to end

The best way to see the platform is with **three phones** (or one phone and two
others), signed into the Customer app, the Shop app and the Rider app at once.

**Set up first.** In the Rider app, sign in as Basheer Koya and turn
**Go on shift** on. Nothing can be delivered without a rider on shift — that is
a real rule, not a demo quirk.

Then:

| # | On the **Customer** app | What happens elsewhere |
|---|---|---|
| 1 | Sign in with any mobile number, add an address | — |
| 2 | Pick an industry, pick a shop, add items to the cart | Stock is checked live against that shop's shelf |
| 3 | Checkout → **Cash on delivery** → Place order | — |
| 4 | Tracking screen says *Finding a shop* | **The Shop app lights up with an offer and a 60-second countdown** |
| 5 | — | Shop taps **Accept** → order moves to *Preparing* |
| 6 | Tracking says *Being prepared* | Shop packs, then taps **Ready** |
| 7 | Tracking says *Rider on the way* | **The job appears in the Rider app** |
| 8 | — | Rider: *On the way to pickup* → *Collected* → *On the way to you* |
| 9 | Tracking shows a **4-digit code** | Rider asks the customer for it at the door and types it in |
| 10 | Order shows **Delivered** | Shop's stock drops; rider's earnings go up |

**Try the interesting failure too.** At step 5, let the 60 seconds run out
instead of accepting. The order does **not** fail — it is silently offered to the
next-nearest shop that has the stock, and the customer never sees that anything
happened. That is the single most important behaviour in the platform.

---

## 5. How the platform decides things

### Which shop gets the order
Shops that are open, within delivery range of the address, and actually holding
the stock — nearest first. Not "whoever pays most". The customer app says so at
the bottom of the shop list.

### The 60-second window
A shop has 60 seconds to accept. Miss it, or reject it, and the order moves to
the next shop automatically. The customer is never asked to try again. The
60 seconds is a setting, not a hard-coded number — it can be changed from the
Master dashboard without a new app release.

### Stock
Every shop keeps a live count. A customer order reserves stock immediately and
removes it only when the rider actually walks out with the goods — because until
then the shop still physically has it. Shops also keep a **safety buffer** so
walk-in counter sales can't oversell what the app has promised.

If a shop runs out of the same item three times in a row, that item hides itself
until the shop re-confirms the count.

### Which rider
The nearest delivery partner who is on shift, within range, and not already
carrying a job.

There are **two kinds of delivery partner**, and the split is strict:

- **RoadMate's own partners** — can be given any shop's order.
- **A shop's own delivery boys** — can *only* be given that shop's orders.

They use the same app and are tracked identically. The difference is who employs
them, not how the delivery works. This matters commercially: a shop with its own
riders can go live in an area where RoadMate has no riders yet.

### The code at the door
Delivery is confirmed by the customer reading a 4-digit code to the rider. It is
the only thing standing between *delivered* and *marked delivered*.

If a rider arrives and there is nothing to collect, or nobody to deliver to, that
is recorded as a **dead run** — a wasted trip the rider is still paid for, because
they still made it.

### The money
- Rider pay: **₹25 base, first 2 km included, ₹8/km after.** A 5 km delivery
  pays ₹49.
- The platform collects everything and settles to shops weekly.
- Commission and rider pay are **frozen onto each order at the moment it is
  delivered** — so changing a rate next month never silently reprices last
  month's orders.
- Cash-on-delivery cash is tracked as owed by the rider until it is handed in.

Every one of these numbers is editable from the Master dashboard. None of them
are written into the apps.

---

## 6. The business half

Sign into **RoadMate Shop** and open **Restock**. A shop orders from its
distributor; the distributor sees it in **RoadMate Distributor** and fulfils it;
the distributor in turn orders from **RoadMate Manufacturer**. When goods
arrive, the shop's shelf goes *up* — the same shelf customer orders draw *down*.

**RoadMate Regional** is the oversight app: the partners in an area, approvals
waiting, and what the area earned.

---

## 7. What is not switched on in this demo

Everything below is **built and tested** — it is switched off or waiting on
something external, and each is a one-line change when the client is ready.

| Thing | Why | What to do |
|---|---|---|
| **OTP by SMS** | The client's DLT/SMS registration has expired | Renew it; the code then arrives by text instead of on screen |
| **Online card/UPI payment** | Works, but needs live Razorpay keys | Cash on delivery works fully today. Prepaid opens a real Razorpay checkout page |
| **Gym memberships** | These are prepaid-only, so they need the above | Same fix as payments |
| **Prescription upload** | Pharmacy orders can attach a photo; needs image storage configured | Configure storage |
| **Push notifications** | Screens refresh by polling instead | Wire a push provider |

Two things are genuinely still to do, and are not code: **Play Store
screenshots**, and deciding the **start dates for partners approved before the
platform started recording them**.

---

## 8. Practical notes for running the demo

- **The apps talk to a server on the internet.** They work anywhere, on mobile
  data or any Wi-Fi. Nothing needs to be on the same network.
- **The first screen after a quiet spell may take up to a minute.** The demo
  server sleeps when unused and takes about 50 seconds to wake. Once awake it is
  fast. If a screen times out, pull to refresh once.
- **Everyone shares one demo world.** Two people signed in as the same shop see
  the same orders. That is usually what you want for a demo; just be aware of it.
- **Anything can be reset.** The demo data is re-seedable, so an experiment that
  makes a mess is not a problem.

---

*Questions about anything in here — ask. Nothing in this document is a promise
the apps do not already keep.*
