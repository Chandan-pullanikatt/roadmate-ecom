# Grill: RoadMate — what we're building, scope, and subscription model
Date: 2026-06-12

## Intent
Build the back-office for RoadMate, a multi-industry B2B2C commerce ecosystem (Swiggy/Blinkit-style consumer ordering on top of a partner hierarchy). The developer owns the 7 web dashboards (Master, State, Industry-State, District, Regional, Manufacturer, Distributor) plus a new backend (Express + Prisma + Postgres). Four mobile apps (Customer, Partner/shop, Executive, Distributor) already exist for the Automobile industry on a Laravel/PHP backend the developer has never seen; this phase extends everything to multiple industries.

## Constraints
- Existing production system: 4 live mobile apps on a PHP (Laravel) backend; developer has no access to its code or DB yet (requested, pending from client).
- Client directed a brand-new backend be built — relationship to the Laravel backend is undefined.
- UI/UX team is concurrently designing mobile app screens; the 7 dashboard HTML designs were produced by the developer and sent to the client.

## Key decisions
- Decision: Subscriptions (shop / delivery / distributor / manufacturer) live in the Master dashboard's existing "Revenue Models & Partner Share Overview" builder. Reason: the design already models revenue events with amounts + per-tier partner share %. Alternative considered: asking the client where it should go — unnecessary, the design already answers it.
- Decision: Revenue Model structure must be extended from a single flat `amount` to a tenure-based pricing schedule (free months 1–3, then tier windows 4–6 / 7–9 / 10–12 / Y2), and must support both one-time fees (e.g. delivery ₹1,000 setup with jersey+bag) and recurring subscriptions. Reason: client's pricing table cannot be expressed as one number.
- Decision: gather a consolidated client question list before building the subscription schema. Reason: collection mechanics (auto-charge vs manual), billing anchor, and revenue-model questions change the schema shape.

## Surfaced assumptions
- The new backend's entire schema (roles, hierarchy, order model) was designed without ever seeing the production Laravel system it must coexist with or replace.
- The 15% order-commission split engine in `orderController.js` is not stated anywhere in the client's phase-1 PDF — the PDF's revenue summaries list only partnerships + subscriptions. The commission model's origin/validity is unconfirmed.
- The Order model is purely B2B (shop ↔ distributor/manufacturer); no Customer model, consumer orders, cart, delivery assignment, or payment gateway exists in the new backend, despite the ecosystem including a consumer app and delivery partners.
- No `DELIVERY` role exists in the schema; no Subscription/SubscriptionPayment models; no `approvedAt` timestamp on User (the 3-month free clock currently has no anchor).
- Developer assumed (unverified) that subscription collection is manual in phase 1, not auto-charged.

## Open questions
Sent to client as a consolidated list — see conversation. Headline items: access to existing Laravel code/DB; whether the new backend replaces or coexists with it; whether subscription tiers are monthly or one-time; billing clock anchor; manufacturer Y2 amount; auto-charge vs manual collection; whether order commission exists at all and where 15% came from; subscription share splits per category; non-payment policy; meaning of "each industry keeps different tables".

## Out of scope
- The 4 mobile apps themselves (UI/UX team designing; existing apps live on Laravel).
- Automatic recurring billing infrastructure — not building until client confirms it's required.
