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
