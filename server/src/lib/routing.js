// Phase 1.5 — the routing engine.
//
// An order is not bound to a shop (HANDOFF §3). It is *offered*, one shop at a
// time, as a `FulfilmentAttempt`. Every way an offer can end — timeout, reject,
// stockout — funnels through `advanceOrder()` below, so there is exactly one
// implementation of "close this attempt and try the next shop".
//
// TWO RULES THIS FILE EXISTS TO ENFORCE
//
// 1. **The claim is the lock.** Whoever flips a `FulfilmentAttempt` out of
//    OFFERED with a conditional `updateMany` owns the reroute. That single
//    statement is what stops a sweeper and an accepting shop, or two sweepers,
//    from acting on the same offer. Count 0 means someone else got there — stop,
//    do not "recover".
//
// 2. **A reservation lives on one shop's shelf.** Rerouting therefore has to
//    release shop A's `reserved` and take it on shop B *inside one transaction*.
//    Reserving is the same conditional `UPDATE ... WHERE (quantity - reserved)
//    >= needed` as placement (§1.4), because the new shop can sell out between
//    being ranked and being offered.
//
// Candidates come from `rankCandidateShops()` — the one ranking in the codebase.
// This file does not sort shops.
import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { requiredFreeUnits } from './inventory.js';
import { rankCandidateShops } from './shopRanking.js';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';
import { refundPayment } from './razorpay.js';
import { needsPrescription, isVoucherOnly } from './fulfilment.js';
import { issueVoucher } from './voucher.js';
import { releaseSlot } from './booking.js';
import { notifyUser } from './push.js';

/** Statuses from which an order may still be re-offered to another shop. */
const ROUTABLE = new Set(['PLACED', 'ROUTING', 'ACCEPTED', 'PREPARING', 'READY']);

/** Attempt statuses that count toward a shop's fulfilment rate (OFFERED does not). */
const RESPONDED = ['ACCEPTED', 'REJECTED', 'TIMED_OUT', 'STOCKOUT'];

// `industry` and `prescriptions` are here for §1.9's gate — see `isRoutable`.
export const orderInclude = {
  items: true,
  address: true,
  attempts: true,
  payment: true,
  industry: true,
  prescriptions: true
};

/** The line list both `requireStock` and the reservation statements take. */
export const orderLines = (order) =>
  order.items.map((i) => ({
    productId: i.productId,
    variantId: i.variantId ?? null,
    quantity: i.quantity
  }));

/**
 * A prepaid order is routable only once the money has landed. Offering an unpaid
 * order would have a shop packing goods for a payment that may never arrive —
 * and `ConsumerOrderStatus.PLACED` is documented as "paid or COD confirmed".
 */
export const isPayableNow = (order) =>
  order.payment?.method !== 'PREPAID' || order.payment?.status === 'PAID';

/**
 * §1.9 — VERIFY_AND_DELIVER's gate. A pharmacy order must not reach any shop's
 * inbox until a `Prescription` on it is APPROVED.
 *
 * This is deliberately the *same shape* as the payment gate above rather than a
 * new mechanism: an order sits at PLACED with its attempt row parked, and
 * `beginRouting()` makes it live once the gate opens. §1.8's webhook and a
 * pharmacist's approval are two doors into one hallway.
 *
 * The throw is a tripwire, not defensiveness. If `industry` was not included,
 * `order.industry?.fulfilmentType` would be undefined, `needsPrescription`
 * would say false, and an unverified pharmacy order would be offered to a
 * shop — a silent failure of the one rule this function exists to enforce.
 */
export function prescriptionCleared(order) {
  if (order.industry === undefined) {
    throw new Error('prescriptionCleared() needs `industry` included on the order.');
  }
  if (!needsPrescription(order.industry?.fulfilmentType)) return true;
  return (order.prescriptions ?? []).some((p) => p.status === 'APPROVED');
}

/** Every gate an order must clear before a shop may be shown it. */
export const isRoutable = (order) => isPayableNow(order) && prescriptionCleared(order);

// --- reservations ------------------------------------------------------------

/**
 * Take `lines` on `shop`'s shelf, or take nothing at all.
 *
 * The predicate is re-evaluated by Postgres under the row lock, so a shop that
 * sold out since it was ranked matches zero rows. A partial success is rolled
 * back line by line before returning false, because the caller goes straight on
 * to the next candidate and must not leave units held at a shop it rejected.
 *
 * @returns {Promise<boolean>} true only if every line is now held
 */
export async function reserveLines(tx, shop, lines) {
  const taken = [];

  for (const line of lines) {
    const needed = requiredFreeUnits(line.quantity, shop.safetyStockBuffer);

    const updated = await tx.$executeRaw`
      UPDATE "ShopInventory"
      SET "reserved" = "reserved" + ${line.quantity}
      WHERE "shopId" = ${shop.id}
        AND "productId" = ${line.productId}
        AND "variantId" IS NOT DISTINCT FROM ${line.variantId}::int
        AND "isAvailable" = true
        AND ("quantity" - "reserved") >= ${needed}
    `;

    if (updated === 0) {
      await releaseLines(tx, shop.id, taken);
      return false;
    }
    taken.push(line);
  }

  return true;
}

/**
 * Give `lines` back to `shopId`'s shelf.
 *
 * `GREATEST(..., 0)` is a floor, not a licence: `reserved` should never be able
 * to go negative, and if a double release ever does happen the shelf must end up
 * over-cautious rather than selling stock twice.
 */
export async function releaseLines(tx, shopId, lines) {
  for (const line of lines) {
    await tx.$executeRaw`
      UPDATE "ShopInventory"
      SET "reserved" = GREATEST("reserved" - ${line.quantity}, 0)
      WHERE "shopId" = ${shopId}
        AND "productId" = ${line.productId}
        AND "variantId" IS NOT DISTINCT FROM ${line.variantId}::int
    `;
  }
}

// --- offers ------------------------------------------------------------------

/** `offeredAt + accept_window_seconds`, always from config. Never 60. */
async function acceptWindow(industryId, now) {
  const seconds = await getConfigNumber(CONFIG_KEYS.ACCEPT_WINDOW_SECONDS, industryId);
  return new Date(now.getTime() + seconds * 1000);
}

/**
 * The one place an offer's push fires — `openFirstAttempt`, `beginRouting`
 * and `routeToNext` all call this instead of touching `push.js` directly, so
 * "notify the shop an offer is live" exists in exactly one spot. Best-effort:
 * a dead phone or an Expo hiccup must never fail the transaction that opened
 * the offer, so this always runs after the transaction commits.
 */
function notifyShopOffered(shopId, order) {
  notifyUser(shopId, {
    title: 'New order',
    body: `Order #${order.id} — respond within the accept window.`,
    data: { type: 'OFFER', orderId: order.id }
  }).catch((err) => console.error('[push] offer notify failed for order', order.id, err.message));
}

async function createAttempt(tx, { order, shopId, sequence, now, expiresAt }) {
  return tx.fulfilmentAttempt.create({
    data: {
      consumerOrderId: order.id,
      shopId,
      sequence,
      status: 'OFFERED',
      offeredAt: now,
      expiresAt
    }
  });
}

/**
 * Open sequence 1, called from inside the placement transaction (§1.4).
 *
 * The attempt row is created for orders that are not offered yet — prepaid
 * awaiting its webhook, or (§1.9) a pharmacy order awaiting approval — because
 * it is the only record of *whose shelf holds the reservation*. `isRoutable`
 * keeps the sweeper and the shop's offer list off it until the gate opens, and
 * `beginRouting()` then makes it live.
 */
export async function openFirstAttempt(tx, order, shopId, now = new Date()) {
  const expiresAt = await acceptWindow(order.industryId, now);
  const attempt = await createAttempt(tx, { order, shopId, sequence: 1, now, expiresAt });

  if (isRoutable(order)) {
    await tx.consumerOrder.update({ where: { id: order.id }, data: { status: 'ROUTING' } });
    notifyShopOffered(shopId, order);
  }

  return attempt;
}

/**
 * Make a placed-but-gated order live: the one entry point for "whatever was
 * holding this order back has cleared, proceed".
 *
 * Two doors lead here and neither knows about the other — §1.8's Razorpay
 * webhook after it marks a payment PAID, and §1.9's prescription approval. An
 * order behind both gates is started by whichever clears second, because each
 * caller re-checks *all* the gates rather than only its own.
 *
 * The accept window starts now, not at placement: the shop has not been looking
 * at the order in the meantime.
 *
 * §1.9: a NO_DELIVERY order has no shop to offer to and no window to open, so
 * this hands off to `issueVoucher()` instead. That keeps the branch out of the
 * routing engine while leaving callers a single function to call.
 */
export async function beginRouting(orderId, now = new Date()) {
  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId },
    include: orderInclude
  });
  if (!order || order.status !== 'PLACED' || !isRoutable(order)) return { started: false };

  if (isVoucherOnly(order.industry?.fulfilmentType)) {
    const result = await issueVoucher(orderId, now);
    return { started: result.issued, outcome: 'VOUCHER_ISSUED', voucher: result.voucher };
  }

  const latest = latestAttempt(order);
  if (!latest) return { started: false };

  const expiresAt = await acceptWindow(order.industryId, now);

  await prisma.$transaction(async (tx) => {
    await tx.fulfilmentAttempt.update({
      where: { id: latest.id },
      data: { status: 'OFFERED', offeredAt: now, expiresAt, respondedAt: null }
    });
    await tx.consumerOrder.update({ where: { id: orderId }, data: { status: 'ROUTING' } });
  });

  notifyShopOffered(latest.shopId, order);
  return { started: true, shopId: latest.shopId };
}

const latestAttempt = (order) =>
  [...(order.attempts ?? [])].sort((a, b) => b.sequence - a.sequence)[0] ?? null;

// --- the one way an offer ends -----------------------------------------------

/**
 * Close one attempt and hand the order to the next-ranked shop.
 *
 * Every caller in §1.5–§1.6 goes through here: the sweeper (TIMED_OUT), a shop
 * rejecting (REJECTED) and a shop discovering it cannot fulfil after accepting
 * (STOCKOUT). The candidate list is built *before* the transaction so the
 * transaction stays short; the reservation `UPDATE` inside it is what actually
 * decides whether a candidate can serve.
 *
 * @param {object}   args
 * @param {number}   args.attemptId       the attempt being closed
 * @param {string}   args.fromStatus      claim only if it is still in this status
 * @param {string}   args.terminalStatus  TIMED_OUT · REJECTED · STOCKOUT
 * @param {string}   [args.reason]
 * @param {Date}     [args.now]
 * @param {boolean}  [args.requireExpired] the sweeper's extra guard
 * @param {Function} [args.onClaimed]     `(tx, {order, lines, shopId})` — extra
 *        bookkeeping that must be in the same transaction as the claim, and must
 *        not happen if the claim is lost. §1.6's stockout counters use this.
 * @returns {Promise<{claimed:boolean, outcome:string, shop?:object, reason?:string}>}
 */
export async function advanceOrder({
  attemptId,
  fromStatus,
  terminalStatus,
  reason = null,
  now = new Date(),
  requireExpired = false,
  onClaimed = null
}) {
  const attempt = await prisma.fulfilmentAttempt.findUnique({
    where: { id: attemptId },
    include: { consumerOrder: { include: orderInclude } }
  });

  if (!attempt || attempt.status !== fromStatus) return skip('ALREADY_HANDLED');
  if (requireExpired && attempt.expiresAt >= now) return skip('NOT_EXPIRED');

  const order = attempt.consumerOrder;
  if (!ROUTABLE.has(order.status)) return skip('ORDER_CLOSED');
  if (!isPayableNow(order)) return skip('AWAITING_PAYMENT');
  if (!prescriptionCleared(order)) return skip('AWAITING_PRESCRIPTION');

  const lines = orderLines(order);
  const candidates = await nextCandidates(order, lines);

  return prisma.$transaction(async (tx) => {
    // THE CLAIM. One statement, and it is the whole concurrency story: if this
    // updates 0 rows another sweeper or the shop's accept got here first.
    const claimed = await tx.fulfilmentAttempt.updateMany({
      where: {
        id: attemptId,
        status: fromStatus,
        ...(requireExpired ? { expiresAt: { lt: now } } : {})
      },
      data: { status: terminalStatus, respondedAt: now, reason }
    });
    if (claimed.count === 0) return skip('LOST_RACE');

    if (onClaimed) await onClaimed(tx, { order, lines, shopId: attempt.shopId });

    // The shop we just closed is the one holding the stock.
    await releaseLines(tx, attempt.shopId, lines);
    await recomputeFulfilmentRate(tx, attempt.shopId);

    return routeToNext(tx, { order, lines, candidates, now, sequence: attempt.sequence + 1 });
  });
}

const skip = (reason) => ({ claimed: false, outcome: 'SKIPPED', reason });

/**
 * Offer the order to the first candidate whose shelf will actually take it, or
 * cancel if none will. Assumes the previous holder's reservation is released and
 * runs inside the caller's transaction.
 *
 * Exported because the sweeper's crash-recovery pass needs the identical tail
 * without a `FulfilmentAttempt` to claim.
 */
export async function routeToNext(tx, { order, lines, candidates, now, sequence }) {
  const expiresAt = await acceptWindow(order.industryId, now);

  for (const shop of candidates) {
    if (!(await reserveLines(tx, shop, lines))) continue; // sold out since ranking

    await createAttempt(tx, { order, shopId: shop.id, sequence, now, expiresAt });
    await tx.consumerOrder.update({
      where: { id: order.id },
      // shopId goes back to null: a rerouted order is unowned again until the
      // new shop accepts. This matters after a STOCKOUT, where it was bound.
      data: { status: 'ROUTING', shopId: null, acceptedAt: null }
    });

    notifyShopOffered(shop.id, order);
    return { claimed: true, outcome: 'REROUTED', shop };
  }

  await cancelForNoShop(tx, order, now);
  return { claimed: true, outcome: 'CANCELLED' };
}

/**
 * Candidates for the *next* offer: ranked shops, minus every shop already tried,
 * keeping only those that can currently sell every line.
 *
 * Ranked against the delivery address — not wherever the customer was standing
 * when they filled the cart.
 */
async function nextCandidates(order, lines) {
  const tried = (order.attempts ?? []).map((a) => a.shopId);
  return rankCandidateShops(order.address.latitude, order.address.longitude, order.industryId, {
    excludeShopIds: tried,
    requireStock: lines
  });
}

/**
 * No shop left. The platform absorbs this (HANDOFF §3) — the customer gets their
 * money back and nobody is fined.
 *
 * The real gateway refund is §1.8's; what happens here is that the debt is
 * recorded the moment the order dies, rather than discovered at settlement. A
 * COD order was never collected, so it closes as FAILED — leaving it PENDING
 * forever would leave it in every "money owed" query.
 */
async function cancelForNoShop(tx, order, now) {
  await tx.consumerOrder.update({
    where: { id: order.id },
    data: {
      status: 'CANCELLED',
      shopId: null,
      cancelledAt: now,
      cancelReason: 'No shop nearby could fulfil this order.'
    }
  });

  await closePaymentAsRefundable(tx, order, now);
}

/**
 * Shared by cancellation and the dead run in §1.7.
 *
 * The `Payment` flag is the truth: it is written the moment the debt exists,
 * inside this transaction, whether or not the gateway call below ever
 * succeeds. That call is fired *without awaiting it* — `void ... .catch()` —
 * because a slow or unreachable Razorpay must never hold this transaction's
 * locks open. It only fires at all for a captured PREPAID payment; a PENDING
 * one was never collected; a COD payment has no gateway to call.
 */
export async function closePaymentAsRefundable(tx, order, now = new Date()) {
  const payment = order.payment ?? (await tx.payment.findUnique({ where: { consumerOrderId: order.id } }));
  if (!payment) return;

  if (payment.status === 'PAID') {
    const refundAmount = new Prisma.Decimal(payment.amount);
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundAmount, refundedAt: now }
    });

    if (payment.method === 'PREPAID' && payment.razorpayPaymentId) {
      void refundPayment({ razorpayPaymentId: payment.razorpayPaymentId, amount: refundAmount }).catch(
        (err) => console.error('[refund] gateway call failed for payment', payment.id, err.message)
      );
    }
  } else if (payment.status === 'PENDING') {
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
  }
}

/**
 * §1.9 — kill an order that never got past its gate.
 *
 * A rejected prescription is the case this exists for: the order is still
 * PLACED, a shop's shelf is holding its reservation, and nobody is ever going
 * to come and collect it. Releasing that reservation is the whole point —
 * leaving it is how a pharmacy's shelf silently shrinks.
 *
 * The parked `FulfilmentAttempt` is deliberately left in OFFERED rather than
 * flipped to REJECTED. That row records *whose shelf held the stock*; it was
 * never actually shown to the shop, and marking it REJECTED would count against
 * a shop's `fulfilmentRate` for an offer it never saw. `advanceOrder()` skips it
 * as ORDER_CLOSED, and `listOffers` filters it out on `isRoutable`.
 */
export async function cancelPlacedOrder(orderId, { reason, now = new Date() } = {}) {
  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId },
    include: orderInclude
  });
  if (!order || !['PLACED', 'ROUTING'].includes(order.status)) {
    return { cancelled: false, reason: 'ORDER_CLOSED' };
  }

  const lines = orderLines(order);
  const holder = latestAttempt(order);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.consumerOrder.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: 'CANCELLED', shopId: null, cancelledAt: now, cancelReason: reason }
    });
    if (claimed.count === 0) return { cancelled: false, reason: 'LOST_RACE' };

    if (holder) await releaseLines(tx, holder.shopId, lines);
    // A booking holds a place in a `ServiceSlot` the way a delivery holds stock
    // on a shelf, and an abandoned one has to give it back — otherwise a turf's
    // busiest hour is quietly held by an order that will never be paid for.
    // No-op for every other fulfilment type, where `slotId` is null.
    await releaseSlot(tx, order.slotId);
    await closePaymentAsRefundable(tx, order, now);

    return { cancelled: true };
  });
}

// --- the ranking consequence -------------------------------------------------

/**
 * `accepted / responded`, as a percent.
 *
 * This is the entire penalty for missing an order (HANDOFF §3: a shop pays in
 * ranking, not in fines) — `rankCandidateShops` sorts on `fulfilmentRate`, so a
 * shop that ignores offers slides down the list on its own.
 *
 * `routingPriority` is deliberately NOT touched here. It is the manual demotion
 * lever an operator sets; having two writers would mean an automated recompute
 * silently undoing a human decision.
 */
export async function recomputeFulfilmentRate(tx, shopId) {
  const grouped = await tx.fulfilmentAttempt.groupBy({
    by: ['status'],
    where: { shopId, status: { in: RESPONDED } },
    _count: { _all: true }
  });

  const total = grouped.reduce((n, g) => n + g._count._all, 0);
  if (total === 0) return;

  const accepted = grouped.find((g) => g.status === 'ACCEPTED')?._count._all ?? 0;
  const rate = Math.round((accepted / total) * 10000) / 100;

  await tx.user.update({ where: { id: shopId }, data: { fulfilmentRate: rate } });
}
