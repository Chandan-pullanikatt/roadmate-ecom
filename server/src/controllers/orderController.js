import prisma from '../lib/prisma.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';


// List orders (buyer / seller views)
export const getOrders = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    let whereClause = {};

    if (role === 'MASTER') {
      whereClause = {};
    } else if (role === 'MANUFACTURER' || role === 'DISTRIBUTOR') {
      // Commercial accounts view orders received as seller, or placed as buyer
      whereClause = {
        OR: [
          { sellerId: userId },
          { buyerId: userId }
        ]
      };
    } else if (role === 'SHOP') {
      whereClause = { buyerId: userId };
    } else {
      // Administrator profiles see order volumes under their location boundaries
      if (req.user.stateName) {
        whereClause.buyer = { stateName: req.user.stateName };
      }
      if (req.user.industryId) {
        whereClause.industryId = req.user.industryId;
      }
    }

    const orders = await prisma.tradeOrder.findMany({
      where: whereClause,
      include: {
        buyer: {
          select: { id: true, name: true, businessName: true, role: true }
        },
        seller: {
          select: { id: true, name: true, businessName: true, role: true }
        },
        industry: {
          select: { name: true }
        },
        items: {
          include: {
            product: true
          }
        },
        payouts: {
          include: {
            recipient: {
              select: { name: true, role: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      status: 'success',
      orders
    });
  } catch (error) {
    console.error('Get Orders Error:', error);
    res.status(500).json({ message: 'Server error retrieving B2B orders.' });
  }
};

// Create a B2B order
export const createOrder = async (req, res) => {
  try {
    const { sellerId, items, industryId } = req.body;
    const buyerId = req.user.id;

    if (!sellerId || !items || items.length === 0) {
      return res.status(400).json({ message: 'Seller and items are required' });
    }

    // Verify seller exists
    const seller = await prisma.user.findUnique({ where: { id: parseInt(sellerId) } });
    if (!seller) {
      return res.status(404).json({ message: 'Seller not found' });
    }

    // Validate products and compute total amount
    let totalAmount = 0;
    const itemsData = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: parseInt(item.productId) }
      });

      if (!product) {
        return res.status(404).json({ message: `Product ID ${item.productId} not found` });
      }

      const qty = parseInt(item.quantity);
      if (product.stockLevel < qty) {
        return res.status(400).json({ 
          message: `Insufficient stock for '${product.name}'. Available: ${product.stockLevel}, Requested: ${qty}` 
        });
      }

      totalAmount += product.price * qty;
      itemsData.push({
        productId: product.id,
        quantity: qty,
        price: product.price
      });
    }

    // Generate Order Number
    const orderNumber = 'RM-PO-' + Math.floor(100000 + Math.random() * 900000);

    const order = await prisma.tradeOrder.create({
      data: {
        orderNumber,
        buyerId,
        sellerId: parseInt(sellerId),
        industryId: industryId ? parseInt(industryId) : req.user.industryId || seller.industryId,
        totalAmount,
        status: 'Pending',
        items: {
          create: itemsData
        }
      },
      include: {
        items: true
      }
    });

    res.status(201).json({
      status: 'success',
      order
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    res.status(500).json({ message: 'Server error placing order.' });
  }
};

// Update order status & trigger automated payout distribution splits
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Pending, Approved, Dispatched, Delivered, Cancelled

    if (!status) {
      return res.status(400).json({ message: 'Please specify status' });
    }

    const orderId = parseInt(id);

    // Get order details
    const order = await prisma.tradeOrder.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        buyer: true,
        seller: true
      }
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Update status
    const updatedOrder = await prisma.tradeOrder.update({
      where: { id: orderId },
      data: { status },
      include: { items: true }
    });

    // If order was dispatched or approved, decrement standard stock levels
    if (status === 'Approved' || status === 'Dispatched') {
      for (const item of order.items) {
        await prisma.product.update({
          where: { id: item.productId },
          data: {
            stockLevel: {
              decrement: item.quantity
            }
          }
        });
      }
    }

    // If order is delivered, calculate fee splits and distribute to partner ledgers
    if (status === 'Delivered') {
      console.log(`Processing payout splits for Order ${order.orderNumber}...`);
      
      // The B2B commission pool. Was `order.totalAmount * 0.15` — the one place
      // in the platform where money was decided by a constant nobody could
      // change without a deploy (HANDOFF §7bis.2). The number is unchanged; who
      // may change it next is not. Note this is `b2b_commission_percent`, NOT
      // the B2C `commission_percent`: two flows, two rates, and conflating them
      // would silently reprice one of them the first time the other moved.
      const b2bCommissionPercent = await getConfigNumber(
        CONFIG_KEYS.B2B_COMMISSION_PERCENT,
        order.industryId
      );
      const commissionPool = order.totalAmount * (b2bCommissionPercent / 100);


      // Let's recursively resolve the onboarding hierarchy of the buyer (the shop)
      let currentBuyer = await prisma.user.findUnique({
        where: { id: order.buyerId }
      });

      let regionalPartner = null;
      let districtPartner = null;
      let indStatePartner = null;
      let statePartner = null;
      let masterAdmin = await prisma.user.findFirst({ where: { role: 'MASTER' } });

      // Traverse parent hierarchy to find active regional, district, state partners
      let tempParent = currentBuyer;
      while (tempParent && tempParent.parentId) {
        const parent = await prisma.user.findUnique({
          where: { id: tempParent.parentId }
        });

        if (!parent) break;

        if (parent.role === 'REGIONAL') regionalPartner = parent;
        if (parent.role === 'DISTRICT') districtPartner = parent;
        if (parent.role === 'IND_STATE') indStatePartner = parent;
        if (parent.role === 'STATE') statePartner = parent;

        tempParent = parent;
      }

      // The five tier shares of that pool. Also formerly hardcoded
      // (10/15/20/25/30), also unchanged in value. `User.sharePercentage` still
      // wins where a partner has been given a bespoke rate — config is the
      // default for everyone who has not.
      const [stateShare, indStateShare, districtShare, regionalShare, masterShare] =
        await Promise.all([
          getConfigNumber(CONFIG_KEYS.TIER_SHARE_STATE, order.industryId),
          getConfigNumber(CONFIG_KEYS.TIER_SHARE_IND_STATE, order.industryId),
          getConfigNumber(CONFIG_KEYS.TIER_SHARE_DISTRICT, order.industryId),
          getConfigNumber(CONFIG_KEYS.TIER_SHARE_REGIONAL, order.industryId),
          getConfigNumber(CONFIG_KEYS.TIER_SHARE_MASTER, order.industryId)
        ]);

      const splits = [
        { role: 'STATE', partner: statePartner, defaultShare: stateShare },
        { role: 'IND_STATE', partner: indStatePartner, defaultShare: indStateShare },
        { role: 'DISTRICT', partner: districtPartner, defaultShare: districtShare },
        { role: 'REGIONAL', partner: regionalPartner, defaultShare: regionalShare },
        { role: 'MASTER', partner: masterAdmin, defaultShare: masterShare }
      ];

      const payoutData = [];

      for (const split of splits) {
        const activePartner = split.partner;
        if (activePartner) {
          const sharePct = activePartner.sharePercentage || split.defaultShare;
          const splitAmount = commissionPool * (sharePct / 100);

          payoutData.push({
            tradeOrderId: order.id,
            recipientId: activePartner.id,
            percentage: sharePct,
            amount: splitAmount,
            status: 'Settled'
          });
        }
      }

      if (payoutData.length > 0) {
        // Clear any old payouts to prevent duplicates
        await prisma.payout.deleteMany({ where: { tradeOrderId: order.id } });
        
        await prisma.payout.createMany({
          data: payoutData
        });
        console.log(`Created ${payoutData.length} split payouts.`);
      }
    }

    res.status(200).json({
      status: 'success',
      order: updatedOrder
    });
  } catch (error) {
    console.error('Update Order Status Error:', error);
    res.status(500).json({ message: 'Server error updating order status.' });
  }
};

// Retrieve payouts log for active user
export const getPayouts = async (req, res) => {
  try {
    const rows = await prisma.payout.findMany({
      where: { recipientId: req.user.id },
      include: {
        tradeOrder: {
          select: { orderNumber: true, totalAmount: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Keep the response key `order` — the dashboards read payout.order.
    const payouts = rows.map(({ tradeOrder, ...payout }) => ({
      ...payout,
      order: tradeOrder
    }));

    res.status(200).json({
      status: 'success',
      payouts
    });
  } catch (error) {
    console.error('Get Payouts Error:', error);
    res.status(500).json({ message: 'Server error fetching payouts.' });
  }
};
