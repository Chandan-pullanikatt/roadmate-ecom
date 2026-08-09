// Records the client's confirmed commercial decisions as `PlatformConfig` rows.
//
// `npm run config:apply`
//
// The point is the difference between a **default** and a **decision**. Every
// key below already had a fallback in `CONFIG_DEFAULTS`, so the pipeline ran
// either way — but a fallback is what the code does when nobody has said
// anything, and it is indistinguishable from an oversight. A row in
// `PlatformConfig` is a thing a human chose, on a date, and it is what
// `applyCommissionSplit()` freezes onto every delivered order.
//
// Idempotent, and safe to re-run: `setConfig` updates in place rather than
// inserting a second global row (Phase 0's note — Postgres treats NULL
// `industryId`s as distinct, so the database alone cannot enforce one row per
// key; this service is what does).
//
// ⚠️ Only put a key here once the client has actually confirmed it. Anything
// still unanswered belongs in `CONFIG_DEFAULTS` where its provenance is
// visible — the three `rider_*` pay rows deliberately stay at 0 there, and
// promoting them to "decided" without a figure is the exact mistake this file
// exists to prevent (PLAN §7.3).
import prisma from '../lib/prisma.js';
import { CONFIG_KEYS, setConfig, getConfig } from '../lib/platformConfig.js';

/** key → [value, when it was confirmed, who by / how]. */
const CONFIRMED = {
  [CONFIG_KEYS.COMMISSION_PERCENT]: [
    15,
    '2026-08-07',
    'Client confirmed 15%, with the caveat that he may revise it later. Until now this ' +
      'was the undocumented fallback inherited from orderController.js:196 — the number ' +
      'was the same, but nobody had chosen it. A revision is one re-run of this script ' +
      'with a new value; orders already delivered keep the split frozen at delivery.'
  ],
  [CONFIG_KEYS.TAX_PERCENT]: [
    5,
    '2026-08-07',
    "From the client's own spec rather than a market guess: designs/Partner.png's bill " +
      'panel reads Subtotal ₹125 / Tax ₹6.25 / Delivery partner fee ₹25 / Grand Total ' +
      '₹156.25 — and 6.25 is exactly 5% of 125. This is the global default only; ' +
      'see PER_INDUSTRY below, because one flat rate across seven industries is wrong.'
  ],
  [CONFIG_KEYS.DELIVERY_FEE]: [
    25,
    '2026-08-07',
    'The same bill panel, same reasoning: ₹25 flat. This unblocks PLAN §7.3 — the ' +
      'customer bill has been showing a visible 0 for both lines rather than an ' +
      'invented figure, and neither may launch that way.'
  ],

  // --- Rider pay (client call, 2026-08-07) -----------------------------------
  // A 5 km delivery therefore pays ₹25 + (5 − 2) × ₹8 = ₹49.
  [CONFIG_KEYS.RIDER_BASE_FEE]: [
    25,
    '2026-08-07',
    'Client call. ₹25 for any completed delivery. Riders are independent partners ' +
      '(HANDOFF §3), so this is their income from the drop, not a top-up on a wage. ' +
      'Until now all three rider rates were 0 and a successful delivery paid nothing.'
  ],
  [CONFIG_KEYS.RIDER_FREE_KM]: [
    2,
    '2026-08-07',
    'The first 2 km are inside the base fare. Distance pay starts beyond this.'
  ],
  [CONFIG_KEYS.RIDER_PER_KM_FEE]: [
    8,
    '2026-08-07',
    '₹8 per km beyond the free 2 km. Straight-line pickup-to-drop distance — the ' +
      'platform has no maps provider, so a real road-distance figure would be a ' +
      'fiction. Frozen onto the job at delivery; a later rise never reprices a ' +
      'trip already made.'
  ],

  // --- Partner subscriptions (client call, 2026-08-07) -----------------------
  //
  // ⚠️ TWO OF THESE THREE CHANGED, and one changed *downwards*. The old
  // hardcoded numbers were shop ₹5,000 and distributor ₹10,000. The client's
  // actual figures are shop ₹3,000, distributor ₹5,000, manufacturer ₹10,000 —
  // so ₹10,000 moved from the distributor to the manufacturer, and the
  // distributor halved. Anyone reading an old screenshot of the District
  // dashboard is reading superseded prices.
  //
  // ⚠️ NONE OF THESE HAS EVER BEEN INVOICED. There is still no plan, trial,
  // invoice or payment model in the schema (HANDOFF §7bis.1). These figures
  // ✅ These are now billed for real (HANDOFF §7ter, built 2026-08-09):
  // `npm run billing` turns a fee into a `SubscriptionInvoice` once a partner's
  // 3-month trial ends, and the District dashboard's rows are paid invoices
  // rather than the `UNBILLED_FEE` projection they used to be.
  // ⚠️ A fee with no row means the partner is **not invoiced at all** — not
  // that they are free — so an environment where this script has never run
  // bills nobody.
  [CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP]: [
    3000,
    '2026-08-07',
    'Client call: ₹3,000/month, starting after the 3-month free trial. Was 5000 as ' +
      'a code fallback nobody had chosen. The trial clock runs from approval, not ' +
      'signup — `User.approvedAt` exists for that — but nothing bills it yet.'
  ],
  [CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR]: [
    5000,
    '2026-08-07',
    'Client call: ₹5,000/month. HALVED from the old hardcoded 10000.'
  ],
  [CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER]: [
    10000,
    '2026-08-07',
    'Client call: ₹10,000/month — the figure that had never been given at all ' +
      '(HANDOFF §7.1), so this key was rendering "—" everywhere. Now set.'
  ],
  // ✅ Billing exists as of 2026-08-09 (HANDOFF §7ter), so these two stopped
  // being hypothetical. Both have real code defaults, so a fresh environment is
  // correct without this script — they are written anyway because they are
  // *decisions the client stated*, and a stated decision should be a row a
  // human can see and change rather than a constant only a developer can find.
  [CONFIG_KEYS.SUBSCRIPTION_TRIAL_MONTHS]: [
    3,
    '2026-08-07',
    'A hard requirement from the client’s manager: three months free, counted ' +
      'from approval (`User.approvedAt`), not from signup.'
  ],
  [CONFIG_KEYS.SUBSCRIPTION_INVOICE_DUE_DAYS]: [
    7,
    '2026-08-09',
    'Payment terms on a subscription invoice. Nothing is suspended when it ' +
      'lapses — the account simply reads PAST_DUE for whoever chases it.'
  ]
};

/**
 * Per-industry `tax_percent` overrides, by industry slug.
 *
 * ⚠️ **One flat tax rate across seven industries is wrong.** Indian GST is
 * per-category — a restaurant bill is not taxed like a gym membership and
 * neither is taxed like a car part. `PlatformConfig` is already per-industry
 * overridable (`@@unique([key, industryId])`), so this needs no schema change:
 * a global default plus one row per industry.
 *
 * These are the standard rates for each category and they are *defensible*, not
 * *authoritative*: which of them applies, and **who collects and remits the
 * GST** — the platform or the shop — is a question for the client's CA, not for
 * code. Each is one re-run of this script to change.
 *
 * An industry that is not seeded is skipped, not created: this script records
 * decisions, it does not invent catalogue rows. Pharmacy and gym are in
 * HANDOFF §1's seven but not in `seed.js`'s six, so they will simply report as
 * absent until they exist.
 */
const PER_INDUSTRY = {
  [CONFIG_KEYS.TAX_PERCENT]: {
    restaurant: [5, 'Restaurant service — 5% without input credit, the standard for food service.'],
    groceries: [5, 'Most packaged staples sit at 5%; unbranded fresh goods are nil-rated.'],
    pharmacy: [5, 'Most formulations are 5%; a handful of categories are 12%.'],
    gym: [18, 'Gym and club memberships are a service at 18%.'],
    automobile: [18, 'Auto parts and accessories are 18% (a few are 28%).'],
    electronics: [18, 'Consumer electronics and appliances, 18%.'],
    textiles: [5, 'Apparel up to ₹1,000 is 5%; above that it is 12%.'],
    sports: [18, 'Sports goods, 18%.']
  }
};

export async function applyConfirmedConfig({ log = console.log } = {}) {
  const applied = [];

  for (const [key, [value, confirmedOn, note]] of Object.entries(CONFIRMED)) {
    const before = await getConfig(key);
    await setConfig(key, value);
    applied.push({ key, value, before, confirmedOn, note });
    log(
      before === String(value)
        ? `  = ${key} already ${value}`
        : `  → ${key} ${before === null ? '(unset)' : before} → ${value}`
    );
  }

  const industries = await prisma.industry.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map(industries.map((i) => [i.slug, i.id]));

  for (const [key, bySlug] of Object.entries(PER_INDUSTRY)) {
    for (const [slug, [value, note]] of Object.entries(bySlug)) {
      const industryId = idBySlug.get(slug);
      if (!industryId) {
        log(`  · ${key} [${slug}] skipped — no such industry`);
        continue;
      }
      // The *override row itself*, not `getConfig` — that would resolve to the
      // global row when no override exists and report "already 5" for a row
      // that is not there.
      const existing = await prisma.platformConfig.findFirst({ where: { key, industryId } });
      const before = existing?.value ?? null;
      await setConfig(key, value, industryId);
      applied.push({ key, industryId, slug, value, before, note });
      log(
        before === String(value)
          ? `  = ${key} [${slug}] already ${value}`
          : `  → ${key} [${slug}] ${before === null ? '(unset)' : before} → ${value}`
      );
    }
  }

  return applied;
}

// Run directly, not on import — this file is also read by a test.
if (process.argv[1] && process.argv[1].endsWith('applyConfirmedConfig.js')) {
  console.log('Applying confirmed platform config…');
  applyConfirmedConfig()
    .then(() => {
      console.log('Done.');
      return prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error('Failed:', error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
