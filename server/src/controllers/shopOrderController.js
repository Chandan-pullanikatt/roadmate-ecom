// Phase 1.6 — the shop's side of a consumer order.
//
// Four verbs: accept, reject, stockout, and walk the lifecycle. Only the first
// one binds the order; the other three hand it on, and they hand it on through
// `advanceOrder()` in `lib/routing.js` — the same function the sweeper uses — so
// "close this attempt and try the next shop" has exactly one implementation.
//
// ACCEPT IS A CLAIM, NOT AN UPDATE. `updateMany` on
//   status = OFFERED AND expiresAt >= now
// is what makes a tap that lands a millisecond after the window closes lose
// cleanly, rather than binding an order the sweeper has already rerouted. A
// count of 0 is a 409, never a retry.
//
// Reservations need no work on accept: placement (§1.4) or the reroute (§1.5)
// already put them on *this* shop's shelf. Accepting commits them by leaving
// them alone; `quantity` drops at delivery (§1.7).
import prisma from '../lib/prisma.js';
import { toMoney } from '../lib/cart.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';
import { advanceOrder, recomputeFulfilmentRate, isRoutable } from '../lib/routing.js';
import { assignRiderIfPossible } from '../lib/delivery.js';
import { promisedEtaMinutes } from '../lib/eta.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Only the shop's own two steps. PLACED/ROUTING/PICKED/DELIVERED are not its call. */
const SHOP_TRANSITIONS = { PREPARING: ['ACCEPTED'], READY: ['PREPARING'] };

// `industry` + `prescriptions` are what `isRoutable` needs (§1.9): an offer is
// hidden until *every* gate has opened, not just the payment one.
const orderInclude = {
  items: true,
  payment: true,
  address: true,
  customer: true,
  industry: true,
  prescriptions: true
};

/** What the shop is allowed to see: the goods, the money, and where it goes. */
function shopOrderView(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt,
    acceptedAt: order.acceptedAt,
    instructions: order.instructions,
    // §1.9 — for COOK_AND_DELIVER this already includes the kitchen's own prep
    // time, so the shop is not being asked to hit a number that ignores it.
    promisedEtaMin: order.promisedEtaMin,

    subtotal: toMoney(order.subtotal),
    grandTotal: toMoney(order.grandTotal),
    paymentMethod: order.payment?.method ?? null,
    paymentStatus: order.payment?.status ?? null,

    items: (order.items ?? []).map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: toMoney(i.unitPrice),
      addOns: i.addOnsJson ?? []
    })),

    // The shop packs for an address it can see, but not for a customer it can
    // contact directly — that is the platform's relationship.
    dropArea: order.address
      ? { landmark: order.address.landmark, city: order.address.city, pincode: order.address.pincode }
      : null
  };
}

/** GET /api/shop/offers — the 60-second-timer screen from HANDOFF §5. */
export const listOffers = async (req, res) => {
  try {
    const now = new Date();

    const offers = await prisma.fulfilmentAttempt.findMany({
      where: { shopId: req.user.id, status: 'OFFERED', expiresAt: { gt: now } },
      include: { consumerOrder: { include: orderInclude } },
      orderBy: { expiresAt: 'asc' }
    });

    return res.status(200).json({
      status: 'success',
      offers: offers
        // An order awaiting its Razorpay webhook (§1.8) or a pharmacist's
        // approval (§1.9) has an attempt row — it records whose shelf holds the
        // stock — but must not be shown to anyone yet.
        .filter((a) => isRoutable(a.consumerOrder))
        .map((a) => ({
          attemptId: a.id,
          orderId: a.consumerOrderId,
          sequence: a.sequence,
          expiresAt: a.expiresAt,
          // The countdown the app renders. Sent as a duration, not just a
          // timestamp, so a phone with a wrong clock still counts down correctly.
          secondsRemaining: Math.max(0, Math.ceil((a.expiresAt.getTime() - now.getTime()) / 1000)),
          ...shopOrderView(a.consumerOrder)
        }))
    });
  } catch (error) {
    console.error('List Offers Error:', error);
    return res.status(500).json({ message: 'Server error while loading your offers.' });
  }
};

/**
 * The ETA to promise once `shopId` owns `order` (§1.9).
 *
 * The shop row is re-read rather than taken from `req.user`, which `protect`
 * narrows to a handful of columns — `latitude`, `longitude` and `prepTimeMin`
 * are not among them.
 */
async function etaForShop(shopId, order) {
  if (!order.address) return null;
  const shop = await prisma.user.findUnique({
    where: { id: shopId },
    select: { latitude: true, longitude: true, prepTimeMin: true }
  });

  return promisedEtaMinutes({
    fulfilmentType: order.industry?.fulfilmentType,
    shop,
    dropLat: order.address.latitude,
    dropLng: order.address.longitude,
    industryId: order.industryId
  });
}

/** The live offer this shop is being asked about, or null. */
function findLiveOffer(shopId, orderId) {
  return prisma.fulfilmentAttempt.findFirst({
    where: { shopId, consumerOrderId: orderId, status: 'OFFERED' },
    include: { consumerOrder: { include: orderInclude } },
    orderBy: { sequence: 'desc' }
  });
}

/** POST /api/shop/offers/:orderId/accept */
export const acceptOffer = async (req, res) => {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id.' });

    const offer = await findLiveOffer(req.user.id, orderId);
    if (!offer) return res.status(404).json({ message: 'This order is not offered to you.' });
    if (!isRoutable(offer.consumerOrder)) {
      return res.status(409).json({ message: 'This order is not ready to be accepted yet.' });
    }

    const now = new Date();

    // §1.9 — the promise the customer sees is made at the moment a shop binds
    // the order, against *this* shop's distance and *this* kitchen's prep time.
    // Placement's estimate was against the first candidate, which a reroute may
    // well have left behind.
    const promisedEtaMin = await etaForShop(req.user.id, offer.consumerOrder);

    const result = await prisma.$transaction(async (tx) => {
      // THE CLAIM — and the reason a late accept cannot bind an order. The
      // sweeper's TIMED_OUT flip and this both need status = OFFERED, so exactly
      // one of them can win.
      const claimed = await tx.fulfilmentAttempt.updateMany({
        where: { id: offer.id, status: 'OFFERED', expiresAt: { gte: now } },
        data: { status: 'ACCEPTED', respondedAt: now }
      });
      if (claimed.count === 0) return null;

      const order = await tx.consumerOrder.update({
        where: { id: orderId },
        data: {
          status: 'ACCEPTED',
          shopId: req.user.id,
          acceptedAt: now,
          ...(promisedEtaMin == null ? {} : { promisedEtaMin })
        },
        include: orderInclude
      });

      await recomputeFulfilmentRate(tx, req.user.id);
      return order;
    });

    if (!result) {
      return res.status(409).json({
        message: 'This offer has expired or has already been answered.',
        reason: 'OFFER_CLOSED'
      });
    }

    return res.status(200).json({ status: 'success', order: shopOrderView(result) });
  } catch (error) {
    console.error('Accept Offer Error:', error);
    return res.status(500).json({ message: 'Server error while accepting the order.' });
  }
};

/** POST /api/shop/offers/:orderId/reject */
export const rejectOffer = async (req, res) => {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id.' });

    const offer = await findLiveOffer(req.user.id, orderId);
    if (!offer) return res.status(404).json({ message: 'This order is not offered to you.' });

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 200)
        : 'Shop declined the order.';

    // No waiting for the window to close: the customer should not pay for a
    // shop's honesty in seconds.
    const result = await advanceOrder({
      attemptId: offer.id,
      fromStatus: 'OFFERED',
      terminalStatus: 'REJECTED',
      reason
    });

    if (!result.claimed) {
      return res.status(409).json({ message: 'This offer has already been answered.', reason: result.reason });
    }

    return res.status(200).json({ status: 'success', outcome: result.outcome });
  } catch (error) {
    console.error('Reject Offer Error:', error);
    return res.status(500).json({ message: 'Server error while rejecting the order.' });
  }
};

/**
 * POST /api/shop/orders/:orderId/stockout
 *
 * The expensive case: the shop said yes and then found the shelf empty. The
 * order is rerouted, and the SKU carries the consequence — HANDOFF §3's three
 * consecutive stockouts auto-hide it until the shop re-confirms the count.
 */
export const reportStockout = async (req, res) => {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id.' });

    const attempt = await prisma.fulfilmentAttempt.findFirst({
      where: {
        shopId: req.user.id,
        consumerOrderId: orderId,
        status: 'ACCEPTED',
        consumerOrder: { shopId: req.user.id, status: { in: ['ACCEPTED', 'PREPARING', 'READY'] } }
      },
      orderBy: { sequence: 'desc' }
    });
    if (!attempt) {
      return res.status(404).json({ message: 'You have no accepted order matching that id.' });
    }

    const threshold = await getConfigNumber(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, req.user.industryId);
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 200)
        : 'Shop was out of stock after accepting.';

    const result = await advanceOrder({
      attemptId: attempt.id,
      fromStatus: 'ACCEPTED',
      terminalStatus: 'STOCKOUT',
      reason,
      // Same transaction as the claim: if the reroute rolls back, so does the
      // counter, and a shop is never punished for an order it kept.
      onClaimed: (tx, { lines, shopId }) => bumpStockouts(tx, shopId, lines, threshold)
    });

    if (!result.claimed) {
      return res.status(409).json({ message: 'This order has already moved on.', reason: result.reason });
    }

    return res.status(200).json({ status: 'success', outcome: result.outcome });
  } catch (error) {
    console.error('Report Stockout Error:', error);
    return res.status(500).json({ message: 'Server error while reporting the stockout.' });
  }
};

/**
 * Count the miss against each SKU and hide it at the threshold.
 *
 * One statement per line, and the hide decision is made from the incremented
 * value in the same statement — read-then-write here would lose a count under
 * two concurrent stockouts on the same SKU.
 */
async function bumpStockouts(tx, shopId, lines, threshold) {
  for (const line of lines) {
    await tx.$executeRaw`
      UPDATE "ShopInventory"
      SET "consecutiveStockouts" = "consecutiveStockouts" + 1,
          "isAvailable" = CASE
            WHEN "consecutiveStockouts" + 1 >= ${threshold}::int THEN false
            ELSE "isAvailable"
          END
      WHERE "shopId" = ${shopId}
        AND "productId" = ${line.productId}
        AND "variantId" IS NOT DISTINCT FROM ${line.variantId}::int
    `;
  }
}

/** GET /api/shop/orders — the orders this shop actually owns. */
export const listShopOrders = async (req, res) => {
  try {
    const statuses = ['ACCEPTED', 'PREPARING', 'READY', 'PICKED', 'DELIVERED'];
    const orders = await prisma.consumerOrder.findMany({
      where: { shopId: req.user.id, status: { in: statuses } },
      include: orderInclude,
      orderBy: { placedAt: 'desc' },
      take: 100
    });

    return res.status(200).json({ status: 'success', orders: orders.map(shopOrderView) });
  } catch (error) {
    console.error('List Shop Orders Error:', error);
    return res.status(500).json({ message: 'Server error while loading your orders.' });
  }
};

/**
 * PATCH /api/shop/orders/:orderId/status — ACCEPTED → PREPARING → READY.
 *
 * The transition table is explicit, and the guard is again a conditional
 * `updateMany` on the status it must be coming *from*, so two taps cannot walk
 * the order two steps.
 */
export const updateShopOrderStatus = async (req, res) => {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id.' });

    const next = String(req.body?.status || '').toUpperCase();
    const allowedFrom = SHOP_TRANSITIONS[next];
    if (!allowedFrom) {
      return res.status(400).json({
        message: `A shop may only set ${Object.keys(SHOP_TRANSITIONS).join(' or ')}.`
      });
    }

    const order = await prisma.consumerOrder.findFirst({
      where: { id: orderId, shopId: req.user.id }
    });
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const moved = await prisma.consumerOrder.updateMany({
      where: { id: orderId, shopId: req.user.id, status: { in: allowedFrom } },
      data: { status: next }
    });
    if (moved.count === 0) {
      return res.status(409).json({
        message: `An order that is ${order.status} cannot become ${next}.`,
        currentStatus: order.status
      });
    }

    // READY is the trigger for the last mile (§1.7). Assignment failing is not
    // an error for the shop — the goods are packed either way, and the sweeper's
    // job list picks the order up when a rider comes on shift.
    let assignment = null;
    if (next === 'READY') assignment = await assignRiderIfPossible(orderId);

    const fresh = await prisma.consumerOrder.findUnique({ where: { id: orderId }, include: orderInclude });
    return res.status(200).json({
      status: 'success',
      order: shopOrderView(fresh),
      ...(assignment ? { delivery: assignment } : {})
    });
  } catch (error) {
    console.error('Update Shop Order Status Error:', error);
    return res.status(500).json({ message: 'Server error while updating the order.' });
  }
};
