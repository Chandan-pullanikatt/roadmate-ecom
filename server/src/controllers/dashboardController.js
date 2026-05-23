import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getOverview = async (req, res) => {
  try {
    const { role, id: userId, stateName, districtName, regionName, industryId } = req.user;

    // Master Dashboard overview
    if (role === 'MASTER') {
      const totalRevenueResult = await prisma.order.aggregate({
        _sum: { totalAmount: true }
      });
      const totalRevenue = totalRevenueResult._sum.totalAmount || 0;

      const stateCount = await prisma.user.count({ where: { role: 'STATE' } });
      const industryCount = await prisma.user.count({ where: { role: 'IND_STATE' } });
      const pendingCount = await prisma.user.count({ where: { isActive: false } });
      const districtCount = await prisma.user.count({ where: { role: 'DISTRICT' } });
      const regionalCount = await prisma.user.count({ where: { role: 'REGIONAL' } });
      const shopCount = await prisma.user.count({ where: { role: 'SHOP' } });
      const distributorCount = await prisma.user.count({ where: { role: 'DISTRIBUTOR' } });

      return res.status(200).json({
        status: 'success',
        stats: {
          totalRevenue,
          statePartners: stateCount,
          industryPartners: industryCount,
          pendingApprovals: pendingCount,
          districtPartners: districtCount,
          regionalPartners: regionalCount,
          registeredShops: shopCount,
          activeDistributors: distributorCount
        }
      });
    }

    // State Partner Dashboard Overview
    if (role === 'STATE') {
      // Calculate total state B2B orders revenue (under their state boundary)
      const orderRevenueResult = await prisma.order.aggregate({
        where: {
          buyer: { stateName: stateName }
        },
        _sum: { totalAmount: true }
      });
      const stateRevenue = orderRevenueResult._sum.totalAmount || 0;

      // Regional Share is 10% of 15% platform fee = 1.5% of total order value
      const myShare = stateRevenue * 0.015;

      const activeIndState = await prisma.user.count({
        where: { role: 'IND_STATE', stateName: stateName, isActive: true }
      });

      const pendingCount = await prisma.user.count({
        where: { 
          isActive: false, 
          stateName: stateName,
          role: { in: ['DISTRICT', 'REGIONAL'] }
        }
      });

      const districtCount = await prisma.user.count({
        where: { role: 'DISTRICT', stateName: stateName, isActive: true }
      });

      const regionalCount = await prisma.user.count({
        where: { role: 'REGIONAL', stateName: stateName, isActive: true }
      });

      const shopCount = await prisma.user.count({
        where: { role: 'SHOP', stateName: stateName, isActive: true }
      });

      const deliveryCount = await prisma.user.count({
        where: { role: 'EXECUTIVE', stateName: stateName, isActive: true }
      });

      return res.status(200).json({
        status: 'success',
        stats: {
          stateRevenue,
          myShare,
          activeIndustryPartners: activeIndState,
          pendingApprovals: pendingCount,
          districtPartners: districtCount,
          regionalPartners: regionalCount,
          registeredShops: shopCount,
          deliveryRiders: deliveryCount
        }
      });
    }

    // Industry State Partner Overview
    if (role === 'IND_STATE') {
      const orderRevenueResult = await prisma.order.aggregate({
        where: {
          buyer: { stateName: stateName },
          industryId: industryId
        },
        _sum: { totalAmount: true }
      });
      const industryRevenue = orderRevenueResult._sum.totalAmount || 0;
      const myShare = industryRevenue * 0.0225; // 15% of 15% platform commission

      const districtCount = await prisma.user.count({
        where: { role: 'DISTRICT', stateName: stateName, industryId: industryId, isActive: true }
      });

      const regionalCount = await prisma.user.count({
        where: { role: 'REGIONAL', stateName: stateName, industryId: industryId, isActive: true }
      });

      const manufacturerCount = await prisma.user.count({
        where: { role: 'MANUFACTURER', stateName: stateName, industryId: industryId, isActive: true }
      });

      const pendingCount = await prisma.user.count({
        where: {
          isActive: false,
          stateName: stateName,
          industryId: industryId
        }
      });

      return res.status(200).json({
        status: 'success',
        stats: {
          industryRevenue,
          myShare,
          districtPartners: districtCount,
          regionalPartners: regionalCount,
          activeManufacturers: manufacturerCount,
          pendingApprovals: pendingCount
        }
      });
    }

    // District Partner Overview
    if (role === 'DISTRICT') {
      const orderRevenueResult = await prisma.order.aggregate({
        where: {
          buyer: { districtName: districtName },
          industryId: industryId
        },
        _sum: { totalAmount: true }
      });
      const districtRevenue = orderRevenueResult._sum.totalAmount || 0;
      const myShare = districtRevenue * 0.03; // 20% of 15% platform commission

      const regionalCount = await prisma.user.count({
        where: { role: 'REGIONAL', districtName: districtName, industryId: industryId, isActive: true }
      });

      const distributorCount = await prisma.user.count({
        where: { role: 'DISTRIBUTOR', districtName: districtName, industryId: industryId, isActive: true }
      });

      const executiveCount = await prisma.user.count({
        where: { role: 'EXECUTIVE', districtName: districtName, isActive: true }
      });

      const pendingCount = await prisma.user.count({
        where: {
          isActive: false,
          districtName: districtName,
          industryId: industryId
        }
      });

      return res.status(200).json({
        status: 'success',
        stats: {
          districtRevenue,
          myShare,
          regionalPartners: regionalCount,
          activeDistributors: distributorCount,
          fieldExecutives: executiveCount,
          pendingApprovals: pendingCount
        }
      });
    }

    // Regional Partner Overview
    if (role === 'REGIONAL') {
      const orderRevenueResult = await prisma.order.aggregate({
        where: {
          buyer: { regionName: regionName },
          industryId: industryId
        },
        _sum: { totalAmount: true }
      });
      const regionalRevenue = orderRevenueResult._sum.totalAmount || 0;
      const myShare = regionalRevenue * 0.0375; // 25% of 15% platform commission

      const shopCount = await prisma.user.count({
        where: { role: 'SHOP', regionName: regionName, industryId: industryId, isActive: true }
      });

      const executiveCount = await prisma.user.count({
        where: { role: 'EXECUTIVE', bossId: userId, isActive: true }
      });

      return res.status(200).json({
        status: 'success',
        stats: {
          regionalRevenue,
          myShare,
          registeredShops: shopCount,
          activeRiders: executiveCount
        }
      });
    }

    // Manufacturer Overview
    if (role === 'MANUFACTURER') {
      const salesResult = await prisma.order.aggregate({
        where: { sellerId: userId },
        _sum: { totalAmount: true }
      });
      const totalSales = salesResult._sum.totalAmount || 0;

      const completedOrders = await prisma.order.count({
        where: { sellerId: userId, status: 'Delivered' }
      });

      const pendingOrders = await prisma.order.count({
        where: { sellerId: userId, status: { in: ['Pending', 'Approved', 'Dispatched'] } }
      });

      const distributorCount = await prisma.brandDistributorMapping.count({
        where: { manufacturerId: userId, status: 'Active' }
      });

      const productCount = await prisma.product.count({
        where: { ownerId: userId }
      });

      return res.status(200).json({
        status: 'success',
        stats: {
          totalSales,
          completedOrders,
          pendingOrders,
          activeDealers: distributorCount,
          catalogProducts: productCount
        }
      });
    }

    // Distributor Overview
    if (role === 'DISTRIBUTOR') {
      // B2B stock purchased value
      const purchasedResult = await prisma.order.aggregate({
        where: { buyerId: userId, status: 'Delivered' },
        _sum: { totalAmount: true }
      });
      const totalPurchased = purchasedResult._sum.totalAmount || 0;

      // Number of retail shops that buy from this distributor (in their district/industries)
      const mappedShops = await prisma.user.count({
        where: { role: 'SHOP', districtName: districtName, industryId: industryId, isActive: true }
      });

      // Pending dispatch orders to shops
      const pendingShipments = await prisma.order.count({
        where: { sellerId: userId, status: { in: ['Pending', 'Approved'] } }
      });

      // Total products value in stock
      const productCount = await prisma.product.count({
        where: { ownerId: userId }
      });

      return res.status(200).json({
        status: 'success',
        stats: {
          totalPurchased,
          mappedShops,
          pendingShipments,
          warehouseProducts: productCount
        }
      });
    }

    res.status(400).json({ message: 'Invalid role for dashboard metrics.' });
  } catch (error) {
    console.error('Dashboard Overview Error:', error);
    res.status(500).json({ message: 'Server error retrieving dashboard metrics.' });
  }
};
