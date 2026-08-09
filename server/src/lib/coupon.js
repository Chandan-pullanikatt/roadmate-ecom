// Coupon validation. Separated from the order controller because §1.8's refund
// and settlement paths need the same discount arithmetic.
import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { ZERO } from './cart.js';

/**
 * Resolve and validate a coupon code against a specific cart.
 *
 * @returns {Promise<{coupon: object, discount: Prisma.Decimal} | {error: string}>}
 */
export async function resolveCoupon({ code, customerId, shopId, industryId, subtotal }) {
  const coupon = await prisma.coupon.findUnique({
    where: { code: String(code).trim().toUpperCase() }
  });

  const reject = (error) => ({ error });

  // One message for every failure would be friendlier to guessers than to
  // users; a coupon code is not a secret, so say what is actually wrong.
  if (!coupon || !coupon.isActive) return reject('This coupon code is not valid.');

  const now = new Date();
  if (coupon.validFrom > now) return reject('This coupon is not active yet.');
  if (coupon.validTo < now) return reject('This coupon has expired.');

  if (coupon.shopId && coupon.shopId !== shopId) {
    return reject('This coupon does not apply to this shop.');
  }
  if (coupon.industryId && coupon.industryId !== industryId) {
    return reject('This coupon does not apply to these items.');
  }

  const min = new Prisma.Decimal(coupon.minOrderValue ?? 0);
  if (subtotal.lessThan(min)) {
    return reject(`Add items worth ₹${min.toFixed(2)} to use this coupon.`);
  }

  if (coupon.usageLimit != null) {
    const used = await prisma.consumerOrder.count({ where: { couponId: coupon.id } });
    if (used >= coupon.usageLimit) return reject('This coupon has been fully claimed.');
  }

  const usedByCustomer = await prisma.consumerOrder.count({
    where: { couponId: coupon.id, customerId }
  });
  if (usedByCustomer >= coupon.perUserLimit) {
    return reject('You have already used this coupon.');
  }

  return { coupon, discount: discountFor(coupon, subtotal) };
}

/**
 * PHASE C — the best offer the customer did not have to know about.
 *
 * An `autoApply` coupon has no code to type. When a customer places an order
 * without supplying one, this picks the candidate that saves them the most and
 * that **actually resolves** against this cart.
 *
 * Three things it is careful about:
 *
 *   • **It reuses `resolveCoupon`, one candidate at a time, rather than
 *     reimplementing the checks.** Every window, scope, minimum and limit is
 *     therefore enforced by exactly the code that enforces a typed code. A
 *     second copy of that ladder is how an auto-applied coupon starts ignoring
 *     `perUserLimit` and the platform discounts the same customer forever.
 *
 *   • **Best means largest discount**, with the coupon id as the tie-break so
 *     two equal offers resolve the same way every time. A customer must not get
 *     ₹40 off today and ₹50 off tomorrow on an identical cart.
 *
 *   • **It never returns an error.** A code somebody typed and got wrong
 *     deserves a message; an offer they never asked for and did not qualify for
 *     deserves silence. Failing placement because an auto-apply coupon expired
 *     would be a self-inflicted outage.
 *
 * The candidate list is bounded by the `@@index([autoApply, isActive,
 * validFrom, validTo])` — this runs on every codeless placement.
 *
 * @returns {Promise<{coupon, discount}|null>}
 */
export async function resolveAutoCoupon({ customerId, shopId, industryId, subtotal }) {
  const now = new Date();

  const candidates = await prisma.coupon.findMany({
    where: {
      autoApply: true,
      isActive: true,
      validFrom: { lte: now },
      validTo: { gte: now },
      // Cheap pre-filter only. `resolveCoupon` re-asserts scope below; this is
      // here so a platform with a hundred shop-specific offers does not resolve
      // all of them on every order.
      AND: [
        { OR: [{ shopId: null }, ...(shopId ? [{ shopId }] : [])] },
        { OR: [{ industryId: null }, ...(industryId ? [{ industryId }] : [])] }
      ]
    },
    orderBy: { id: 'asc' }
  });

  let best = null;
  for (const candidate of candidates) {
    const result = await resolveCoupon({
      code: candidate.code,
      customerId,
      shopId,
      industryId,
      subtotal
    });
    if (result.error) continue;
    if (!best || result.discount.greaterThan(best.discount)) {
      best = { coupon: result.coupon, discount: result.discount };
    }
  }

  // A resolved coupon worth nothing is not an offer. Applying it would consume
  // the customer's one use of it and save them ₹0.
  if (best && best.discount.lessThanOrEqualTo(ZERO)) return null;

  return best;
}

/** Flat or percent, capped at `maxDiscount` and never more than the subtotal. */
export function discountFor(coupon, subtotal) {
  const value = new Prisma.Decimal(coupon.discountValue ?? 0);

  let discount =
    coupon.discountType === 'PERCENT' ? subtotal.times(value).dividedBy(100) : value;

  if (coupon.maxDiscount != null) {
    const cap = new Prisma.Decimal(coupon.maxDiscount);
    if (discount.greaterThan(cap)) discount = cap;
  }

  if (discount.greaterThan(subtotal)) discount = subtotal;
  if (discount.lessThan(ZERO)) discount = ZERO;

  return discount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
