import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET /api/master/states — aggregated state overview for Master Dashboard
export const getStatesOverview = async (req, res) => {
  try {
    const statePartners = await prisma.user.findMany({
      where: { role: 'STATE' },
      select: { id: true, name: true, stateName: true, isActive: true }
    });

    const result = await Promise.all(
      statePartners.map(async (sp) => {
        const [districtCount, regionCount, shopCount, revenueResult] = await Promise.all([
          prisma.user.count({ where: { role: 'DISTRICT', stateName: sp.stateName, isActive: true } }),
          prisma.user.count({ where: { role: 'REGIONAL', stateName: sp.stateName, isActive: true } }),
          prisma.user.count({ where: { role: 'SHOP', stateName: sp.stateName, isActive: true } }),
          prisma.order.aggregate({
            where: { buyer: { stateName: sp.stateName } },
            _sum: { totalAmount: true }
          })
        ]);
        return {
          state: sp.stateName || '—',
          partner: sp.name,
          districts: districtCount,
          regions: regionCount,
          shops: shopCount,
          revenue: revenueResult._sum.totalAmount || 0,
          status: sp.isActive ? 'Active' : 'Inactive'
        };
      })
    );

    res.status(200).json({ status: 'success', states: result });
  } catch (error) {
    console.error('States Overview Error:', error);
    res.status(500).json({ message: 'Server error fetching states overview.' });
  }
};

// GET /api/master/districts — aggregated district overview for Master Dashboard
export const getDistrictsOverview = async (req, res) => {
  try {
    const districtPartners = await prisma.user.findMany({
      where: { role: 'DISTRICT' },
      select: { id: true, name: true, stateName: true, districtName: true, isActive: true }
    });

    const result = await Promise.all(
      districtPartners.map(async (dp) => {
        const [regionCount, shopCount, revenueResult] = await Promise.all([
          prisma.user.count({ where: { role: 'REGIONAL', districtName: dp.districtName, isActive: true } }),
          prisma.user.count({ where: { role: 'SHOP', districtName: dp.districtName, isActive: true } }),
          prisma.order.aggregate({
            where: { buyer: { districtName: dp.districtName } },
            _sum: { totalAmount: true }
          })
        ]);
        return {
          district: dp.districtName || '—',
          state: dp.stateName || '—',
          partner: dp.name,
          regions: regionCount,
          shops: shopCount,
          revenue: revenueResult._sum.totalAmount || 0
        };
      })
    );

    res.status(200).json({ status: 'success', districts: result });
  } catch (error) {
    console.error('Districts Overview Error:', error);
    res.status(500).json({ message: 'Server error fetching districts overview.' });
  }
};
