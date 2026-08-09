// Reader for `PlatformConfig`. Accept window, radius and commission are tuned
// in production and must never appear as constants in business logic.
//
// Resolution order: per-industry override → global row → the caller's default.
//
// ⚠️ `PlatformConfig` is `@@unique([key, industryId])`, and Postgres treats
// NULLs as distinct, so the database alone does NOT stop two global rows for
// the same key. That invariant is enforced here: reads take the most recently
// updated row, and `setConfig` updates in place rather than inserting a second.
import prisma from './prisma.js';

export const CONFIG_KEYS = {
  ACCEPT_WINDOW_SECONDS: 'accept_window_seconds',
  DEFAULT_RADIUS_KM: 'default_radius_km',
  COMMISSION_PERCENT: 'commission_percent',
  FULFILMENT_RATE_THRESHOLD: 'fulfilment_rate_threshold',
  RIDER_RANGE_KM: 'rider_range_km',
  TAX_PERCENT: 'tax_percent',
  DELIVERY_FEE: 'delivery_fee',
  STOCKOUT_HIDE_THRESHOLD: 'stockout_hide_threshold',
  DEAD_RUN_FEE: 'dead_run_fee',
  // What a rider is paid for a successful delivery. Riders are independent
  // partners, not employees, so this is their whole income from a drop.
  RIDER_BASE_FEE: 'rider_base_fee',
  RIDER_FREE_KM: 'rider_free_km',
  RIDER_PER_KM_FEE: 'rider_per_km_fee',
  // §1.9 — the promised ETA, and how long a NO_DELIVERY voucher lives.
  BASE_ETA_MIN: 'base_eta_min',
  ETA_MIN_PER_KM: 'eta_min_per_km',
  PREP_TIME_MIN: 'prep_time_min',
  VOUCHER_VALIDITY_DAYS: 'voucher_validity_days',
  // How long a proof-of-delivery photo is kept before `npm run prune:uploads`
  // deletes it. A retention period is a policy, not a constant, and it is the
  // one number that decides how large a pile of photographs of customers' front
  // doors the platform is sitting on. ⚠️ Prescriptions are NOT pruned — they are
  // a medical record of why an order was allowed to proceed (`lib/cloudinary.js`).
  POD_PHOTO_RETENTION_DAYS: 'pod_photo_retention_days',

  // --- B2B (HANDOFF §7bis.2) -------------------------------------------------
  // The trade commission pool and the five tier shares it is split into. These
  // were hardcoded in `orderController.js` — `totalAmount * 0.15` and
  // 10/15/20/25/30 — which meant the B2B side of the platform was the one place
  // money was decided by a constant. `commission_percent` is B2C; this is not
  // the same number and must not be conflated with it.
  B2B_COMMISSION_PERCENT: 'b2b_commission_percent',
  TIER_SHARE_STATE: 'tier_share_state',
  TIER_SHARE_IND_STATE: 'tier_share_ind_state',
  TIER_SHARE_DISTRICT: 'tier_share_district',
  TIER_SHARE_REGIONAL: 'tier_share_regional',
  TIER_SHARE_MASTER: 'tier_share_master',

  // Monthly partner subscriptions. Nobody has ever been charged one — there is
  // no plan, trial, invoice or payment model (HANDOFF §7bis.1) — so these are
  // what the District dashboard *projects*, clearly labelled as unbilled.
  SUBSCRIPTION_FEE_SHOP: 'subscription_fee_shop',
  SUBSCRIPTION_FEE_DISTRIBUTOR: 'subscription_fee_distributor',
  SUBSCRIPTION_FEE_MANUFACTURER: 'subscription_fee_manufacturer',
  // How long the free trial runs, counted from approval, and how long a partner
  // has to pay an invoice before it is overdue. Both are policy the client
  // stated ("3 months free, then monthly"), so both have real defaults — unlike
  // the three fees above, which are prices only the client can set.
  SUBSCRIPTION_TRIAL_MONTHS: 'subscription_trial_months',
  SUBSCRIPTION_INVOICE_DUE_DAYS: 'subscription_invoice_due_days'
};

/** Fallbacks used when a key has no row at all. Documented, not hidden. */
export const CONFIG_DEFAULTS = {
  [CONFIG_KEYS.ACCEPT_WINDOW_SECONDS]: 60,
  [CONFIG_KEYS.DEFAULT_RADIUS_KM]: 5,
  [CONFIG_KEYS.COMMISSION_PERCENT]: 15,
  [CONFIG_KEYS.FULFILMENT_RATE_THRESHOLD]: 85,
  // How far from the customer a rider may be and still count as coverage.
  [CONFIG_KEYS.RIDER_RANGE_KM]: 10,
  // Both stay 0 *as fallbacks*, and both are now answered as rows:
  // `npm run config:apply` writes tax_percent 5 and delivery_fee 25, from the
  // client's own designs/Partner.png bill panel (₹125 + ₹6.25 + ₹25 = ₹156.25),
  // plus a per-industry `tax_percent` override each, because Indian GST is
  // per-category and one flat rate across seven industries is wrong. A 0 here
  // now means the script has never been run against this database — which is
  // exactly what it should look like.
  [CONFIG_KEYS.TAX_PERCENT]: 0,
  [CONFIG_KEYS.DELIVERY_FEE]: 0,
  // HANDOFF §3: 3 consecutive stockouts on a SKU auto-hide it until the shop
  // re-confirms the count.
  [CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD]: 3,
  // What the platform pays a rider for a wasted trip. 0 until the client gives a
  // figure — same reasoning as tax and delivery fee, and it is not a guess worth
  // inventing (PLAN §7).
  [CONFIG_KEYS.DEAD_RUN_FEE]: 0,
  // Rider pay: base fare, plus a per-km rate on distance beyond a free radius.
  // Same category as the dead-run fee — this is what the client pays a delivery
  // partner, and only the client can decide it, so all three default to 0 and a
  // delivery earns nothing until they are set. The *shape* is now built and
  // frozen at delivery; only the numbers are outstanding. `rider_free_km` at 0
  // means "charge per km from the first metre", which is a real answer rather
  // than a placeholder — the two fee rows are the ones to fill in.
  [CONFIG_KEYS.RIDER_BASE_FEE]: 0,
  [CONFIG_KEYS.RIDER_FREE_KM]: 0,
  [CONFIG_KEYS.RIDER_PER_KM_FEE]: 0,

  // --- §1.9 ------------------------------------------------------------------
  // These four are NOT in the "default to 0 until the client says" category, and
  // the distinction matters. Tax, delivery fee and the dead-run fee are *client
  // policy* — money the client alone decides, where a plausible invented number
  // would ship silently as if it were confirmed. The four below are
  // *operational estimates* that have no correct-by-fiat value and where 0 is
  // not a visible placeholder but an outright lie ("arriving in 0 minutes",
  // "voucher expired the moment you bought it"). They are seeded with defensible
  // urban-delivery figures, documented here, and tunable per industry:
  //
  //   base_eta_min          picking, packing and handover at the shop
  //   eta_min_per_km        ≈15 km/h door-to-door on Indian city roads
  //   prep_time_min         COOK_AND_DELIVER fallback when a shop has not set
  //                         its own `User.prepTimeMin`
  //   voucher_validity_days how long a NO_DELIVERY voucher stays redeemable
  //
  // ⚠️ `voucher_validity_days` is the one to confirm with the client — a gym
  // membership's real duration is a commercial term, not an estimate (PLAN §7).
  [CONFIG_KEYS.BASE_ETA_MIN]: 10,
  [CONFIG_KEYS.ETA_MIN_PER_KM]: 4,
  [CONFIG_KEYS.PREP_TIME_MIN]: 15,
  [CONFIG_KEYS.VOUCHER_VALIDITY_DAYS]: 30,

  // Proof-of-delivery photos answer "was this actually delivered", and that is
  // asked within days — a COD dispute, a customer claiming a no-show. 90 days
  // is a generous version of that window; past it the photos are cost and
  // exposure with no remaining use. Set it to 0 to keep them forever.
  [CONFIG_KEYS.POD_PHOTO_RETENTION_DAYS]: 90,

  // --- B2B -------------------------------------------------------------------
  // These carry the values that were hardcoded before, so moving them here
  // changed no figure — only who is allowed to change them next.
  [CONFIG_KEYS.B2B_COMMISSION_PERCENT]: 15,
  [CONFIG_KEYS.TIER_SHARE_STATE]: 10,
  [CONFIG_KEYS.TIER_SHARE_IND_STATE]: 15,
  [CONFIG_KEYS.TIER_SHARE_DISTRICT]: 20,
  [CONFIG_KEYS.TIER_SHARE_REGIONAL]: 25,
  [CONFIG_KEYS.TIER_SHARE_MASTER]: 30,

  // ⚠️ **The three `subscription_fee_*` keys deliberately have NO default here.**
  //
  // They used to: 5000 for a shop and 10000 for a distributor, inherited from
  // `revenueController.js`. On 2026-08-07 the client gave real figures and two
  // of the three were *different* — shop ₹3,000, distributor ₹5,000,
  // manufacturer ₹10,000 — which is the exact hazard a plausible-looking code
  // fallback creates: it had been quoting a superseded price on a dashboard for
  // months and nothing looked wrong.
  //
  // So a partner fee is now either something a human said (a `PlatformConfig`
  // row, written by `npm run config:apply` or the Master settings screen) or it
  // is nothing at all. `getConfigNumber` returns null for a key with no default,
  // the API sends `feeConfigured: false`, and the dashboard renders "—". Unset
  // is "nobody has decided"; 0 would be "someone decided it is free". A price
  // this file invents is neither.
  //
  // ⚠️ Since billing was built (2026-08-09) this has a second consequence, and
  // it is the more serious one: `issueInvoicesFor()` **skips** a partner whose
  // fee is unset rather than invoicing ₹0. An unset fee is now an unbilled
  // partner, visible on the Master billing screen, and not a free one.

  // The trial the client's manager committed to: three months, from approval.
  // This one is a real default because it is a stated decision, not a price.
  [CONFIG_KEYS.SUBSCRIPTION_TRIAL_MONTHS]: 3,
  // How long a partner has to pay before the invoice is overdue and the account
  // reads PAST_DUE. Nothing is suspended at that point — being past due is
  // information for whoever chases it, not an automated switch-off.
  [CONFIG_KEYS.SUBSCRIPTION_INVOICE_DUE_DAYS]: 7
};

/**
 * What each key *is*, for the Master settings screen.
 *
 * This lives next to the keys and the defaults on purpose: a new tunable number
 * is one entry in `CONFIG_KEYS`, one in `CONFIG_DEFAULTS` and one here, and it
 * then appears on the settings screen with no UI change at all. The alternative
 * — a label table in `client/` — is how a key gets added and stays invisible.
 *
 * `unit` drives the input's prefix/suffix. `perIndustry` marks the keys where an
 * override is meaningful; `tax_percent` is the obvious one (Indian GST is
 * per-category), `commission_percent` and the ETA estimates are the others.
 */
export const CONFIG_META = {
  [CONFIG_KEYS.COMMISSION_PERCENT]: {
    group: 'Consumer orders (B2C)', label: 'Platform commission', unit: '%', perIndustry: true,
    help: 'The platform’s cut of a delivered consumer order. Frozen onto each order at delivery — changing it never reprices an order already delivered.'
  },
  [CONFIG_KEYS.TAX_PERCENT]: {
    group: 'Consumer orders (B2C)', label: 'Tax (GST)', unit: '%', perIndustry: true,
    help: 'Indian GST is per category. Set the global rate here and override it per industry — restaurant 5%, gym 18%, most goods 18%, medicines 5%.'
  },
  [CONFIG_KEYS.DELIVERY_FEE]: {
    group: 'Consumer orders (B2C)', label: 'Delivery fee', unit: '₹', perIndustry: true,
    help: 'Charged to the customer on the bill, per order.'
  },
  [CONFIG_KEYS.VOUCHER_VALIDITY_DAYS]: {
    group: 'Consumer orders (B2C)', label: 'Voucher validity (fallback)', unit: 'days', perIndustry: true,
    help: 'Only used when the membership variant does not set its own duration. The shop’s own “3 Months” always wins.'
  },

  [CONFIG_KEYS.POD_PHOTO_RETENTION_DAYS]: {
    group: 'Consumer orders (B2C)', label: 'Keep delivery photos for', unit: 'days', perIndustry: false,
    help: 'Proof-of-delivery photos are deleted after this. They answer delivery disputes, which are raised within days. 0 keeps them forever. Prescriptions are never deleted — they are a medical record.'
  },

  [CONFIG_KEYS.RIDER_BASE_FEE]: {
    group: 'Rider pay', label: 'Base fare per delivery', unit: '₹', perIndustry: true,
    help: 'What a rider earns for a delivery before distance. Riders are independent partners — this is their income from the drop.'
  },
  [CONFIG_KEYS.RIDER_FREE_KM]: {
    group: 'Rider pay', label: 'Distance included in the base fare', unit: 'km', perIndustry: true,
    help: 'The per-km rate only applies beyond this. 0 means charge per km from the first metre.'
  },
  [CONFIG_KEYS.RIDER_PER_KM_FEE]: {
    group: 'Rider pay', label: 'Per km beyond that', unit: '₹', perIndustry: true,
    help: 'Multiplied by the pickup-to-drop distance above the included kilometres.'
  },
  [CONFIG_KEYS.DEAD_RUN_FEE]: {
    group: 'Rider pay', label: 'Dead-run fee', unit: '₹', perIndustry: true,
    help: 'A trip that produced nothing — nothing to collect, or nobody to deliver to. The platform pays it; the shop is not deducted.'
  },

  [CONFIG_KEYS.ACCEPT_WINDOW_SECONDS]: {
    group: 'Routing', label: 'Shop accept window', unit: 'sec', perIndustry: true,
    help: 'How long a shop has to answer an offer before it is silently rerouted to the next shop. The sweeper process is what enforces it.'
  },
  [CONFIG_KEYS.DEFAULT_RADIUS_KM]: {
    group: 'Routing', label: 'Default service radius', unit: 'km', perIndustry: false,
    help: 'Fallback only — each shop sets its own radius.'
  },
  [CONFIG_KEYS.RIDER_RANGE_KM]: {
    group: 'Routing', label: 'Rider search range', unit: 'km', perIndustry: false,
    help: 'How far from a pickup a rider may be and still be offered the job.'
  },
  [CONFIG_KEYS.FULFILMENT_RATE_THRESHOLD]: {
    group: 'Routing', label: 'Fulfilment-rate floor', unit: '%', perIndustry: false,
    help: 'Below this a shop is demoted in routing. A shop pays in ranking, never in fines.'
  },
  [CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD]: {
    group: 'Routing', label: 'Stockouts before a SKU is hidden', unit: '', perIndustry: false,
    help: 'Consecutive stockouts on one SKU before it is auto-hidden. Only a recount in the shop app brings it back.'
  },

  [CONFIG_KEYS.BASE_ETA_MIN]: {
    group: 'Delivery estimate', label: 'Base ETA', unit: 'min', perIndustry: true,
    help: 'Picking, packing and handover at the shop.'
  },
  [CONFIG_KEYS.ETA_MIN_PER_KM]: {
    group: 'Delivery estimate', label: 'Minutes per km', unit: 'min', perIndustry: true,
    help: 'Travel time. 4 min/km is roughly 15 km/h door to door.'
  },
  [CONFIG_KEYS.PREP_TIME_MIN]: {
    group: 'Delivery estimate', label: 'Kitchen prep time (fallback)', unit: 'min', perIndustry: true,
    help: 'Restaurants only, and only where the shop has not set its own prep time.'
  },

  [CONFIG_KEYS.B2B_COMMISSION_PERCENT]: {
    group: 'Trade orders (B2B)', label: 'Commission pool', unit: '%', perIndustry: true,
    help: 'The platform’s cut of a delivered trade order, split between the five partner tiers below. Separate from the consumer commission.'
  },
  [CONFIG_KEYS.TIER_SHARE_STATE]: {
    group: 'Trade orders (B2B)', label: 'State partner share', unit: '%', perIndustry: true,
    help: 'Share of the commission pool. A partner with their own agreed rate keeps it — this is the default for everyone else.'
  },
  [CONFIG_KEYS.TIER_SHARE_IND_STATE]: {
    group: 'Trade orders (B2B)', label: 'Industry-state partner share', unit: '%', perIndustry: true
  },
  [CONFIG_KEYS.TIER_SHARE_DISTRICT]: {
    group: 'Trade orders (B2B)', label: 'District partner share', unit: '%', perIndustry: true,
    help: 'Also the district’s share of subscription revenue on its own dashboard.'
  },
  [CONFIG_KEYS.TIER_SHARE_REGIONAL]: {
    group: 'Trade orders (B2B)', label: 'Regional partner share', unit: '%', perIndustry: true
  },
  [CONFIG_KEYS.TIER_SHARE_MASTER]: {
    group: 'Trade orders (B2B)', label: 'Master share', unit: '%', perIndustry: true
  },

  [CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP]: {
    group: 'Partner subscriptions', label: 'Shop monthly fee', unit: '₹', perIndustry: true,
    help: '⚠️ Nobody has ever been invoiced. Subscription billing does not exist yet — this only drives the projections on the District dashboard.'
  },
  [CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR]: {
    group: 'Partner subscriptions', label: 'Distributor monthly fee', unit: '₹', perIndustry: true
  },
  [CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER]: {
    group: 'Partner subscriptions', label: 'Manufacturer monthly fee', unit: '₹', perIndustry: true,
    help: 'Never set. Left blank on purpose — blank means nobody has decided, whereas 0 would mean it is free. A blank fee means the partner is not invoiced at all; it does not mean free.'
  },
  [CONFIG_KEYS.SUBSCRIPTION_TRIAL_MONTHS]: {
    group: 'Partner subscriptions', label: 'Free trial', unit: 'months', perIndustry: false,
    help: 'Counted from the day the partner was approved, not from signup. Changing this only moves the trial of partners approved from now on — a trial already running keeps the end date it was given.'
  },
  [CONFIG_KEYS.SUBSCRIPTION_INVOICE_DUE_DAYS]: {
    group: 'Partner subscriptions', label: 'Invoice payment terms', unit: 'days', perIndustry: false,
    help: 'How long a partner has to pay before the invoice shows as overdue. Nothing is suspended automatically — this is information for whoever chases it.'
  }
};

/** Raw string value, or null. */
export async function getConfig(key, industryId = null) {
  // `in: [id, null]` is not expressible in Prisma — null is not a list member —
  // so the override and the global row are ORed explicitly.
  const scope = industryId == null ? [{ industryId: null }] : [{ industryId }, { industryId: null }];

  const rows = await prisma.platformConfig.findMany({
    where: { key, OR: scope },
    orderBy: { updatedAt: 'desc' }
  });

  // Precedence is picked here, in JS, and NOT by an `industryId: 'desc'` sort:
  // Postgres orders DESC as NULLS FIRST, so that put the *global* row ahead of
  // the per-industry override and silently inverted the documented resolution
  // order. `updatedAt: 'desc'` then enforces "one global row per key" (Phase 0).
  const override = rows.find((r) => r.industryId != null);
  const global = rows.find((r) => r.industryId == null);
  return (override ?? global)?.value ?? null;
}

/** Numeric value with the documented fallback. Never returns NaN. */
export async function getConfigNumber(key, industryId = null) {
  const raw = await getConfig(key, industryId);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : CONFIG_DEFAULTS[key] ?? null;
}

/**
 * Write a config value. Exists so nothing else ever calls `create` directly —
 * that is how a duplicate global row would get in.
 */
export async function setConfig(key, value, industryId = null) {
  const existing = await prisma.platformConfig.findFirst({ where: { key, industryId } });
  if (existing) {
    return prisma.platformConfig.update({
      where: { id: existing.id },
      data: { value: String(value) }
    });
  }
  return prisma.platformConfig.create({ data: { key, value: String(value), industryId } });
}

/**
 * Remove a row so the key falls back to what is behind it — a per-industry
 * override back to the global row, or the global row back to `CONFIG_DEFAULTS`.
 *
 * This is not the same as setting 0, and the Master screen offers both: a
 * cleared manufacturer fee reads "not decided", a zero reads "free". `deleteMany`
 * rather than `delete` because a missing row is the desired end state either way.
 */
export function clearConfig(key, industryId = null) {
  return prisma.platformConfig.deleteMany({ where: { key, industryId } });
}
