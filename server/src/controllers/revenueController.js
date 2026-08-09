import prisma from '../lib/prisma.js';
import { dateFilter, periodRange } from '../utils/period.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';
import { subscriptionPhase } from '../lib/subscription.js';


/*
 * District revenue categories.
 *
 * ✅ **Every row here is now money that moved** (2026-08-09). It was not always:
 * until subscription billing existed, the three fee rows multiplied a monthly
 * fee by a headcount for partners who had never been invoiced — a shop that
 * signed up that morning added ₹5,000 to this table, forever, having paid
 * nothing (§7bis.1). They were labelled `basis: 'UNBILLED_FEE'` and tagged
 * "NOT BILLED" on the dashboard rather than deleted, with a note saying they
 * would become a sum over real invoices once billing was built. This is that.
 *
 *   • `basis: 'ORDERS'` — sums `TradeOrder.totalAmount`. Always was real.
 *   • `basis: 'BILLED'` — sums **PAID `SubscriptionInvoice` rows**. Real money,
 *                         from a partner who was actually invoiced and paid.
 *
 * Two figures ride alongside on every `BILLED` row and neither is collected
 * income, so neither is ever added into `totalCollected`:
 *
 *   • `outstanding` — invoiced and not yet paid. A receivable, which is a real
 *                     thing, but not a bank balance. Not period-filtered: what
 *                     is owed is owed regardless of which month you are looking at.
 *   • `projected`   — fee × active partners, the old number. Kept because it
 *                     answers "what should this district be earning", which is
 *                     a genuinely useful question — as long as nothing confuses
 *                     it for what it *is* earning. That was the original bug.
 *
 * ⚠️ A `BILLED` row reading ₹0 now means nobody has paid, which is a true
 * statement about a platform that has not launched. It used to mean nothing at all.
 */
/*
 * ⚠️ **The rider subscription is gone, not relabelled** (2026-08-07).
 *
 * There used to be a "Delivery Subscriptions" row here charging riders
 * ₹2,000/month. The client has confirmed riders work like Swiggy's — they are
 * independent delivery partners, and a platform *pays* its delivery partners
 * per order (`src/lib/riderPay.js`), it does not bill them a subscription.
 * Deleting the row is the honest fix: leaving it in, however labelled, is a
 * revenue line for money that will never be invoiced.
 *
 * The manufacturer row replaces it, and its fee is deliberately **unset** —
 * see `feeKey` below.
 */
const CATEGORIES = {
  regions:       { emoji: '🤝', label: 'Regions',                    role: 'REGIONAL',     feeKey: null,                                        industryScoped: true },
  shops:         { emoji: '🏪', label: 'Shop Subscriptions',         role: 'SHOP',         feeKey: CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP,           industryScoped: true },
  distributors:  { emoji: '📦', label: 'Distributor Subscriptions',  role: 'DISTRIBUTOR',  feeKey: CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR,    industryScoped: true },
  manufacturers: { emoji: '🏭', label: 'Manufacturer Subscriptions', role: 'MANUFACTURER', feeKey: CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER,   industryScoped: true }
};

/**
 * The monthly fee for a category, or null if there is no fee *to* look up.
 *
 * Two different nulls meet here and they must not be flattened:
 *   · `feeKey === null` — this row is not a subscription at all. Regions is
 *     real order revenue, and its basis is `'ORDERS'`.
 *   · a fee key with **no value and no default** — the client has never given a
 *     figure. `subscription_fee_manufacturer` is exactly this (HANDOFF §7.1),
 *     and it must render as "—" (nobody has decided) rather than ₹0 (someone
 *     decided it is free). `feeConfigured: false` carries that to the screen.
 */
async function feeFor(cfg, industryId) {
  if (!cfg.feeKey) return null;
  const value = await getConfigNumber(cfg.feeKey, industryId);
  return Number.isFinite(value) ? value : null;
}

/** What a row's figure is actually made of. See the note above. */
const basisOf = (cfg) => (cfg.feeKey === null ? 'ORDERS' : 'BILLED');

/*
 * Subscription money for one category, from real invoices.
 *
 * `collected` is period-filtered on `paidAt` — when the money arrived is what a
 * monthly revenue view is asking about. `outstanding` deliberately is **not**:
 * a bill from March that is still unpaid is still owed in August, and hiding it
 * behind a period filter is how a receivable disappears from the only screen
 * that would have shown it.
 */
const subscriptionMoney = async (role, districtName, industryId, industryScoped, period) => {
  const partnerWhere = {
    role, districtName, isActive: true,
    ...(industryScoped ? { industryId } : {})
  };
  const range = periodRange(period);

  const [paid, due] = await Promise.all([
    prisma.subscriptionInvoice.aggregate({
      where: {
        status: 'PAID',
        ...(range ? { paidAt: range } : {}),
        subscription: { user: partnerWhere }
      },
      _sum: { amount: true },
      _count: true
    }),
    prisma.subscriptionInvoice.aggregate({
      where: { status: 'DUE', subscription: { user: partnerWhere } },
      _sum: { amount: true },
      _count: true
    })
  ]);

  return {
    // Decimal → number at the boundary. B2B revenue figures on this dashboard
    // are Floats by design (HANDOFF §6) and this row is summed with them.
    collected: Number(paid._sum.amount ?? 0),
    outstanding: Number(due._sum.amount ?? 0),
    paidCount: paid._count,
    outstandingCount: due._count
  };
};

const PROJECTION_NOTICE =
  'Subscription rows are invoices that were actually paid. "Projected" is the monthly fee × active ' +
  'partners — what the district would earn if every partner past their free trial were billed and paid. ' +
  'The two are never added together.';

// Total real order revenue from buyers tied to a region within the district
// (used by the "Regions" row). Excludes B2B distributor orders that have no region,
// so the summary total matches the per-region drill-down.
const districtRegionOrderRevenue = async (districtName, industryId, periodFilter = {}) => {
  const result = await prisma.tradeOrder.aggregate({
    where: { buyer: { districtName, regionName: { not: null } }, industryId, ...periodFilter },
    _sum: { totalAmount: true }
  });
  return result._sum.totalAmount || 0;
};

// Count of active users of a role within the district (+ industry when scoped).
const roleCount = (role, districtName, industryId, industryScoped) =>
  prisma.user.count({
    where: { role, districtName, isActive: true, ...(industryScoped ? { industryId } : {}) }
  });

/* GET /api/district/revenue — summary table rows + totals */
export const getDistrictRevenue = async (req, res) => {
  try {
    const { role, districtName, industryId } = req.user;
    if (role !== 'DISTRICT') {
      return res.status(403).json({ message: 'District role required.' });
    }
    const periodFilter = dateFilter(req.query.period);

    // The district's cut. Also formerly hardcoded per row, and it is the same
    // tier share `orderController` splits the B2B commission pool by — one
    // number in one place, rather than two that can drift apart.
    const sharePct = await getConfigNumber(CONFIG_KEYS.TIER_SHARE_DISTRICT, industryId);

    const rows = [];
    for (const [key, cfg] of Object.entries(CATEGORIES)) {
      const count = await roleCount(cfg.role, districtName, industryId, cfg.industryScoped);
      const fee = await feeFor(cfg, industryId);
      const isSubscription = cfg.feeKey !== null;

      const money = isSubscription
        ? await subscriptionMoney(cfg.role, districtName, industryId, cfg.industryScoped, req.query.period)
        : null;

      // `totalCollected` now means the same thing on every row: money that
      // arrived. That is what changed when billing was built.
      const totalCollected = isSubscription
        ? money.collected
        : await districtRegionOrderRevenue(districtName, industryId, periodFilter);
      const myEarnings = totalCollected * (sharePct / 100);
      // What the row would be if everybody past their trial were billed and
      // paid. Kept, because it answers a real question — and kept in its own
      // field, because putting it in `totalCollected` was the original bug.
      const projectedCollected = isSubscription ? (fee ?? 0) * count : totalCollected;

      rows.push({
        key,
        emoji: cfg.emoji,
        label: cfg.label,
        totalCollected,
        sharePct,
        myEarnings,
        count,
        basis: basisOf(cfg),
        feePerPartner: fee,
        // false = nobody has set a fee for this category yet. Render "—", not ₹0.
        feeConfigured: cfg.feeKey === null ? null : fee !== null,
        projectedCollected,
        projectedEarnings: projectedCollected * (sharePct / 100),
        // Invoiced and unpaid. A receivable, not income — never summed into
        // `totalCollected`, and deliberately not period-filtered.
        outstanding: money?.outstanding ?? 0,
        outstandingCount: money?.outstandingCount ?? 0,
        paidInvoiceCount: money?.paidCount ?? 0
      });
    }

    const sum = (list, field) => list.reduce((s, r) => s + r[field], 0);
    const totalCollected = sum(rows, 'totalCollected');
    const myEarnings = sum(rows, 'myEarnings');

    res.status(200).json({
      status: 'success',
      rows,
      totals: {
        totalCollected,
        myEarnings,
        // Every row is realised now. The two key names are kept because the
        // dashboard's footer reads them, and the split they draw — earned
        // versus would-be-earned — is still the one worth drawing.
        realisedCollected: totalCollected,
        realisedEarnings: myEarnings,
        projectedCollected: sum(rows, 'projectedCollected'),
        projectedEarnings: sum(rows, 'projectedEarnings'),
        outstanding: sum(rows, 'outstanding')
      },
      notice: PROJECTION_NOTICE
    });
  } catch (error) {
    console.error('District Revenue Error:', error);
    res.status(500).json({ message: 'Server error retrieving district revenue.' });
  }
};

/* GET /api/district/revenue/:category — per-partner drill-down */
export const getDistrictRevenueDetail = async (req, res) => {
  try {
    const { role, districtName, industryId } = req.user;
    if (role !== 'DISTRICT') {
      return res.status(403).json({ message: 'District role required.' });
    }

    const cfg = CATEGORIES[req.params.category];
    if (!cfg) return res.status(404).json({ message: 'Unknown revenue category.' });
    const periodFilter = dateFilter(req.query.period);
    const fee = await feeFor(cfg, industryId);
    const sharePct = await getConfigNumber(CONFIG_KEYS.TIER_SHARE_DISTRICT, industryId);

    const range = periodRange(req.query.period);
    const partners = await prisma.user.findMany({
      where: { role: cfg.role, districtName, isActive: true, ...(cfg.industryScoped ? { industryId } : {}) },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, email: true, phone: true,
        regionName: true, businessName: true,
        // The partner's own billing standing, so the drill-down can say *why* a
        // partner has paid nothing — on trial, never invoiced because no fee is
        // set, or genuinely overdue. Those look identical as a ₹0 row.
        subscription: { select: { trialEndsAt: true, cancelledAt: true, invoices: true } }
      }
    });

    // Attach per-partner revenue.
    const items = [];
    for (const p of partners) {
      let revenue;
      if (cfg.feeKey !== null) {
        const invoices = p.subscription?.invoices ?? [];
        const inWindow = (i) => !range || (i.paidAt && i.paidAt >= range.gte);
        // What this partner actually paid in the window. Not what they would
        // owe — that is `wouldOwe` below, and conflating the two is §7bis.1.
        revenue = invoices
          .filter((i) => i.status === 'PAID' && inWindow(i))
          .reduce((s, i) => s + Number(i.amount), 0);
        p.outstanding = invoices
          .filter((i) => i.status === 'DUE')
          .reduce((s, i) => s + Number(i.amount), 0);
        p.phase = subscriptionPhase(p.subscription, invoices);
        p.wouldOwe = fee ?? 0;
      } else {
        // Region partner: sum of real order revenue from buyers in their region.
        const result = await prisma.tradeOrder.aggregate({
          where: { buyer: { regionName: p.regionName }, industryId, ...periodFilter },
          _sum: { totalAmount: true }
        });
        revenue = result._sum.totalAmount || 0;
      }
      // `subscription` is dropped rather than spread: it carries every invoice
      // row, and a drill-down does not need a partner's full billing history.
      const { subscription, ...partner } = p;
      items.push({ ...partner, revenue, myShare: revenue * (sharePct / 100) });
    }

    const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
    const totalMyShare = items.reduce((s, i) => s + i.myShare, 0);

    res.status(200).json({
      status: 'success',
      category: {
        key: req.params.category,
        label: cfg.label,
        emoji: cfg.emoji,
        sharePct,
        basis: basisOf(cfg),
        feePerPartner: fee,
        feeConfigured: cfg.feeKey === null ? null : fee !== null
      },
      items,
      totals: {
        totalRevenue,
        totalMyShare,
        outstanding: items.reduce((s, i) => s + (i.outstanding ?? 0), 0)
      },
      ...(basisOf(cfg) === 'BILLED' ? { notice: PROJECTION_NOTICE } : {})
    });
  } catch (error) {
    console.error('District Revenue Detail Error:', error);
    res.status(500).json({ message: 'Server error retrieving revenue detail.' });
  }
};
