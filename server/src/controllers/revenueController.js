import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/*
 * District revenue categories. Counts come from real seeded users; the per-unit
 * fees are the onboarding rates used across the District dashboard. "Regions" is
 * order-based (sum of real order revenue), the rest are subscription/onboarding fees.
 */
// industryScoped: EXECUTIVE (delivery riders) are not industry-scoped in this data model.
const CATEGORIES = {
  regions:      { emoji: '🤝', label: 'Regions',                    sharePct: 20, role: 'REGIONAL',    fee: null,  industryScoped: true  },
  shops:        { emoji: '🏪', label: 'Shop Subscriptions',         sharePct: 20, role: 'SHOP',        fee: 5000,  industryScoped: true  },
  delivery:     { emoji: '🚚', label: 'Delivery Subscriptions',     sharePct: 18, role: 'EXECUTIVE',   fee: 2000,  industryScoped: false },
  distributors: { emoji: '📦', label: 'Distributor Subscriptions',  sharePct: 20, role: 'DISTRIBUTOR', fee: 10000, industryScoped: true  }
};

// Total real order revenue from buyers tied to a region within the district
// (used by the "Regions" row). Excludes B2B distributor orders that have no region,
// so the summary total matches the per-region drill-down.
const districtRegionOrderRevenue = async (districtName, industryId) => {
  const result = await prisma.order.aggregate({
    where: { buyer: { districtName, regionName: { not: null } }, industryId },
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

    const rows = [];
    for (const [key, cfg] of Object.entries(CATEGORIES)) {
      const count = await roleCount(cfg.role, districtName, industryId, cfg.industryScoped);
      const totalCollected = cfg.fee !== null
        ? cfg.fee * count
        : await districtRegionOrderRevenue(districtName, industryId);
      const myEarnings = totalCollected * (cfg.sharePct / 100);
      rows.push({
        key,
        emoji: cfg.emoji,
        label: cfg.label,
        totalCollected,
        sharePct: cfg.sharePct,
        myEarnings,
        count
      });
    }

    const totalCollected = rows.reduce((s, r) => s + r.totalCollected, 0);
    const myEarnings = rows.reduce((s, r) => s + r.myEarnings, 0);

    res.status(200).json({ status: 'success', rows, totals: { totalCollected, myEarnings } });
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

    const partners = await prisma.user.findMany({
      where: { role: cfg.role, districtName, isActive: true, ...(cfg.industryScoped ? { industryId } : {}) },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, email: true, phone: true,
        regionName: true, businessName: true
      }
    });

    // Attach per-partner revenue.
    const items = [];
    for (const p of partners) {
      let revenue;
      if (cfg.fee !== null) {
        revenue = cfg.fee; // flat subscription/onboarding fee per partner
      } else {
        // Region partner: sum of real order revenue from buyers in their region.
        const result = await prisma.order.aggregate({
          where: { buyer: { regionName: p.regionName }, industryId },
          _sum: { totalAmount: true }
        });
        revenue = result._sum.totalAmount || 0;
      }
      items.push({ ...p, revenue, myShare: revenue * (cfg.sharePct / 100) });
    }

    const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
    const totalMyShare = items.reduce((s, i) => s + i.myShare, 0);

    res.status(200).json({
      status: 'success',
      category: { key: req.params.category, label: cfg.label, emoji: cfg.emoji, sharePct: cfg.sharePct },
      items,
      totals: { totalRevenue, totalMyShare }
    });
  } catch (error) {
    console.error('District Revenue Detail Error:', error);
    res.status(500).json({ message: 'Server error retrieving revenue detail.' });
  }
};
