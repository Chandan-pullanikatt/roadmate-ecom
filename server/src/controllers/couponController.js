// Coupons — the management surface (PHASE A.3).
//
// The `Coupon` model has been complete since Phase 0 and `resolveCoupon()` has
// applied it at checkout since §1.4: flat or percent, `maxDiscount`,
// `minOrderValue`, a validity window, `isActive`, shop/industry scope,
// `usageLimit` and `perUserLimit`. What did not exist was any way to make one.
// A coupon could only be inserted **by hand with SQL**, which means in practice
// that no coupon has ever existed, and the whole discount half of the platform
// was unreachable.
//
// Two rules this file exists to enforce:
//
//   1. A COUPON THAT HAS BEEN USED IS NEVER DELETED. `ConsumerOrder.couponId`
//      is how a delivered order records *why* it was discounted, and the money
//      on that order was frozen at delivery (`applyCommissionSplit`). Deleting
//      the coupon would either break the foreign key or orphan the explanation
//      for a settled payout. Withdrawing an offer is `isActive: false`, which is
//      the same shape as "remove" on a shop's own delivery boy: deactivation,
//      never unlinking.
//
//   2. THE ARITHMETIC IS VALIDATED AT WRITE TIME, ONCE. `discountFor()` clamps
//      at spend time — a discount never exceeds the subtotal — but a 150% coupon
//      that clamps silently is a coupon somebody typed wrong and nobody was told
//      about. The refusal belongs where a human is looking at a form.
import prisma from '../lib/prisma.js';
import { Prisma } from '@prisma/client';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Decimal → fixed-2 string. Never let a Prisma Decimal reach JSON raw. */
const money = (d) => (d == null ? null : new Prisma.Decimal(d).toFixed(2));

const DISCOUNT_TYPES = ['FLAT', 'PERCENT'];

/**
 * The shape every coupon response takes. `timesUsed` is included because the
 * only thing a human running an offer wants to know is whether it is working,
 * and `usageLimit` is meaningless without it.
 */
const publicCoupon = (coupon, timesUsed) => ({
  id: coupon.id,
  code: coupon.code,
  title: coupon.title,
  subtitle: coupon.subtitle,
  discountType: coupon.discountType,
  discountValue: money(coupon.discountValue),
  maxDiscount: money(coupon.maxDiscount),
  minOrderValue: money(coupon.minOrderValue),
  usageLimit: coupon.usageLimit,
  perUserLimit: coupon.perUserLimit,
  autoApply: coupon.autoApply,
  validFrom: coupon.validFrom,
  validTo: coupon.validTo,
  isActive: coupon.isActive,
  industryId: coupon.industryId,
  industry: coupon.industry ? { id: coupon.industry.id, name: coupon.industry.name } : null,
  shopId: coupon.shopId,
  shop: coupon.shop ? { id: coupon.shop.id, name: coupon.shop.businessName || coupon.shop.name } : null,
  timesUsed: timesUsed ?? undefined,
  // Derived, never stored — the same reasoning as `subscriptionPhase()`: a
  // stored status is a second copy that goes stale the moment the clock moves
  // past it and no job happens to be running.
  phase: couponPhase(coupon)
});

/**
 * Where this coupon is in its life. Derived from the clock and `isActive`, so
 * an expired coupon reports as expired the instant it expires rather than
 * whenever something next writes to it.
 */
export function couponPhase(coupon, now = new Date()) {
  if (!coupon.isActive) return 'WITHDRAWN';
  if (coupon.validFrom > now) return 'SCHEDULED';
  if (coupon.validTo < now) return 'EXPIRED';
  return 'LIVE';
}

/**
 * Validate and normalise a coupon body.
 * @returns {{ok: true, data: object}|{ok: false, message: string, reason: string}}
 */
function parseCouponBody(body, { partial = false } = {}) {
  const bad = (message, reason = 'INVALID_COUPON') => ({ ok: false, message, reason });
  const data = {};
  const has = (k) => body?.[k] !== undefined;
  const required = (k) => !partial && !has(k);

  // ── Code ──
  if (required('code')) return bad('A coupon needs a code.');
  if (has('code')) {
    // Uppercased on the way in, because `resolveCoupon` uppercases what the
    // customer types. Two cases of one code would be two rows, one of which
    // nobody could ever redeem.
    const code = String(body.code).trim().toUpperCase();
    if (!/^[A-Z0-9]{3,24}$/.test(code)) {
      return bad('A code is 3–24 letters and digits, with no spaces or symbols.');
    }
    data.code = code;
  }

  if (required('title')) return bad('A coupon needs a title — it is what the customer reads.');
  if (has('title')) {
    const title = String(body.title).trim();
    if (!title) return bad('A coupon needs a title — it is what the customer reads.');
    data.title = title;
  }

  if (has('subtitle')) {
    const s = body.subtitle == null ? null : String(body.subtitle).trim();
    data.subtitle = s || null;
  }

  // ── The discount ──
  if (required('discountType')) return bad('Choose a flat or a percentage discount.');
  if (has('discountType')) {
    const t = String(body.discountType).trim().toUpperCase();
    if (!DISCOUNT_TYPES.includes(t)) return bad('Choose a flat or a percentage discount.');
    data.discountType = t;
  }

  if (required('discountValue')) return bad('A coupon needs a discount value.');
  if (has('discountValue')) {
    const v = Number.parseFloat(body.discountValue);
    if (!Number.isFinite(v) || v <= 0) return bad('The discount must be more than zero.');
    data.discountValue = new Prisma.Decimal(v.toFixed(2));
  }

  // A percentage over 100 would be the platform paying the customer to shop.
  // `discountFor` clamps it at the subtotal, silently — which is exactly why it
  // is refused here, where somebody is looking at a form.
  const effectiveType = data.discountType ?? null;
  if (effectiveType === 'PERCENT' && data.discountValue && data.discountValue.greaterThan(100)) {
    return bad('A percentage discount cannot be more than 100%.');
  }

  if (has('maxDiscount')) {
    if (body.maxDiscount === null || body.maxDiscount === '') {
      data.maxDiscount = null;
    } else {
      const v = Number.parseFloat(body.maxDiscount);
      if (!Number.isFinite(v) || v <= 0) return bad('A discount cap must be more than zero, or blank.');
      data.maxDiscount = new Prisma.Decimal(v.toFixed(2));
    }
  }

  if (has('minOrderValue')) {
    if (body.minOrderValue === null || body.minOrderValue === '') {
      data.minOrderValue = new Prisma.Decimal(0);
    } else {
      const v = Number.parseFloat(body.minOrderValue);
      if (!Number.isFinite(v) || v < 0) return bad('A minimum order value cannot be negative.');
      data.minOrderValue = new Prisma.Decimal(v.toFixed(2));
    }
  }

  // ── Limits ──
  if (has('usageLimit')) {
    if (body.usageLimit === null || body.usageLimit === '') {
      data.usageLimit = null; // unlimited, and blank means unlimited — not 0
    } else {
      const n = Number.parseInt(body.usageLimit, 10);
      if (!Number.isInteger(n) || n <= 0) return bad('A total usage limit must be at least 1, or blank for unlimited.');
      data.usageLimit = n;
    }
  }

  if (has('perUserLimit')) {
    const n = Number.parseInt(body.perUserLimit, 10);
    // No "unlimited per user": `resolveCoupon` compares against this with `>=`
    // and a null would throw. 1 is the schema default and the sane floor.
    if (!Number.isInteger(n) || n <= 0) return bad('A per-customer limit must be at least 1.');
    data.perUserLimit = n;
  }

  // ── The window ──
  for (const field of ['validFrom', 'validTo']) {
    if (required(field)) return bad('A coupon needs a start and an end date.');
    if (has(field)) {
      const d = new Date(body[field]);
      if (Number.isNaN(d.getTime())) return bad('A coupon needs a valid start and end date.');
      data[field] = d;
    }
  }
  // Checked only when both are known — on a partial update the caller may be
  // moving one of them, and the merged pair is re-checked by the caller.
  if (data.validFrom && data.validTo && data.validFrom >= data.validTo) {
    return bad('A coupon must end after it starts.');
  }

  // ── Scope ──
  // Both may be null (platform-wide), or either may be set. They are ANDed by
  // `resolveCoupon`, so a coupon with both is "this shop, and only when the
  // order is in this industry" — coherent, and left possible on purpose.
  for (const field of ['industryId', 'shopId']) {
    if (has(field)) {
      if (body[field] === null || body[field] === '') {
        data[field] = null;
      } else {
        const id = parseId(body[field]);
        if (!id) return bad(`${field} must be a valid id, or blank.`);
        data[field] = id;
      }
    }
  }

  if (has('isActive')) data.isActive = Boolean(body.isActive);

  // PHASE C — an offer with no code to type. Applied at placement only when the
  // customer supplied no code, and only if it beats the other auto-apply offers
  // that also resolve. The code still exists and still works if typed.
  if (has('autoApply')) data.autoApply = Boolean(body.autoApply);

  return { ok: true, data };
}

const withRelations = {
  industry: { select: { id: true, name: true } },
  shop: { select: { id: true, name: true, businessName: true } }
};

/** How many orders have claimed each of these coupons. One query, not N. */
async function usageByCoupon(couponIds) {
  if (!couponIds.length) return new Map();
  const rows = await prisma.consumerOrder.groupBy({
    by: ['couponId'],
    where: { couponId: { in: couponIds } },
    _count: { _all: true }
  });
  return new Map(rows.map((r) => [r.couponId, r._count._all]));
}

/** GET /api/master/coupons — every coupon, newest first. */
export const listCoupons = async (req, res) => {
  try {
    const coupons = await prisma.coupon.findMany({
      include: withRelations,
      orderBy: { id: 'desc' }
    });
    const used = await usageByCoupon(coupons.map((c) => c.id));

    return res.status(200).json({
      status: 'success',
      coupons: coupons.map((c) => publicCoupon(c, used.get(c.id) ?? 0))
    });
  } catch (error) {
    console.error('List Coupons Error:', error);
    return res.status(500).json({ message: 'Server error loading coupons.' });
  }
};

/** POST /api/master/coupons */
export const createCoupon = async (req, res) => {
  try {
    const parsed = parseCouponBody(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });

    const scopeError = await checkScope(parsed.data);
    if (scopeError) return res.status(400).json(scopeError);

    const coupon = await prisma.coupon.create({
      data: parsed.data,
      include: withRelations
    });
    return res.status(201).json({ status: 'success', coupon: publicCoupon(coupon, 0) });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        message: 'That code is already in use.',
        reason: 'CODE_TAKEN'
      });
    }
    console.error('Create Coupon Error:', error);
    return res.status(500).json({ message: 'Server error creating the coupon.' });
  }
};

/** A scope that names a row which does not exist is a coupon nobody can use. */
async function checkScope(data) {
  if (data.industryId) {
    const industry = await prisma.industry.findUnique({ where: { id: data.industryId } });
    if (!industry) return { message: 'That industry does not exist.', reason: 'BAD_SCOPE' };
  }
  if (data.shopId) {
    const shop = await prisma.user.findFirst({ where: { id: data.shopId, role: 'SHOP' } });
    if (!shop) return { message: 'That shop does not exist.', reason: 'BAD_SCOPE' };
  }
  return null;
}

/** PATCH /api/master/coupons/:id */
export const updateCoupon = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid coupon id.' });

    const existing = await prisma.coupon.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Coupon not found.' });

    const parsed = parseCouponBody(req.body, { partial: true });
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    // Re-check the pair against the merged result: moving only `validTo` must
    // not be allowed to land it before an untouched `validFrom`.
    const from = parsed.data.validFrom ?? existing.validFrom;
    const to = parsed.data.validTo ?? existing.validTo;
    if (from >= to) {
      return res.status(400).json({ message: 'A coupon must end after it starts.', reason: 'INVALID_COUPON' });
    }

    // Same for the percentage ceiling: a type change and a value change can
    // arrive separately, and 150 is only wrong once the type is PERCENT.
    const type = parsed.data.discountType ?? existing.discountType;
    const value = parsed.data.discountValue ?? existing.discountValue;
    if (type === 'PERCENT' && new Prisma.Decimal(value).greaterThan(100)) {
      return res.status(400).json({
        message: 'A percentage discount cannot be more than 100%.',
        reason: 'INVALID_COUPON'
      });
    }

    const scopeError = await checkScope(parsed.data);
    if (scopeError) return res.status(400).json(scopeError);

    const coupon = await prisma.coupon.update({
      where: { id },
      data: parsed.data,
      include: withRelations
    });
    const used = await usageByCoupon([id]);
    return res.status(200).json({ status: 'success', coupon: publicCoupon(coupon, used.get(id) ?? 0) });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'That code is already in use.', reason: 'CODE_TAKEN' });
    }
    console.error('Update Coupon Error:', error);
    return res.status(500).json({ message: 'Server error updating the coupon.' });
  }
};

/**
 * DELETE /api/master/coupons/:id
 *
 * Only ever deletes a coupon **nobody has used**. A used coupon is the recorded
 * reason a delivered order was discounted, and that order's money was frozen at
 * delivery — deleting it would orphan the explanation for a settled payout.
 * Withdrawing a live offer is `isActive: false`, and the response says so by
 * name rather than failing with a foreign-key error nobody can read.
 */
export const deleteCoupon = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid coupon id.' });

    const existing = await prisma.coupon.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Coupon not found.' });

    const used = await prisma.consumerOrder.count({ where: { couponId: id } });
    if (used > 0) {
      return res.status(409).json({
        message: `This coupon has been used on ${used} order${used > 1 ? 's' : ''}, so it is part of their record and cannot be deleted. Switch it off instead.`,
        reason: 'COUPON_IN_USE',
        timesUsed: used
      });
    }

    await prisma.coupon.delete({ where: { id } });
    return res.status(200).json({ status: 'success', message: 'Coupon deleted.' });
  } catch (error) {
    console.error('Delete Coupon Error:', error);
    return res.status(500).json({ message: 'Server error deleting the coupon.' });
  }
};

/**
 * GET /api/customer/coupons?shopId&industryId — the offers a customer can see.
 *
 * Until this existed a customer had to already know a code to type, which makes
 * every coupon the platform runs invisible to everybody who was not told about
 * it out of band. This is the "Offers" list.
 *
 * What it deliberately does NOT do is promise the coupon will apply.
 * `resolveCoupon` is still the authority at checkout: it re-checks the window,
 * the minimum order value, both usage limits and the scope against the actual
 * cart. This endpoint filters out only what is *certainly* unusable — withdrawn,
 * outside its window, globally exhausted, already used up by this customer, or
 * scoped to a different shop or industry. `minOrderValue` is shown rather than
 * filtered on, because a customer whose cart is ₹40 short should be told to add
 * ₹40 of items, not shown nothing.
 */
export const listCustomerCoupons = async (req, res) => {
  try {
    const shopId = req.query.shopId ? parseId(req.query.shopId) : null;
    const industryId = req.query.industryId ? parseId(req.query.industryId) : null;
    const now = new Date();

    const coupons = await prisma.coupon.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        validTo: { gte: now },
        // A null scope is platform-wide and always in. A set scope must match
        // what the customer is looking at — otherwise this endpoint would
        // advertise one shop's offers on another shop's page.
        AND: [
          { OR: [{ shopId: null }, ...(shopId ? [{ shopId }] : [])] },
          { OR: [{ industryId: null }, ...(industryId ? [{ industryId }] : [])] }
        ]
      },
      include: withRelations,
      orderBy: { validTo: 'asc' } // expiring soonest first — that is the urgency
    });

    // Both usage limits, applied per customer. Two counts rather than one,
    // because "fully claimed" and "you have already used this" are different
    // facts and only the second depends on who is asking.
    const ids = coupons.map((c) => c.id);
    const globalUse = await usageByCoupon(ids);
    const mineRows = ids.length
      ? await prisma.consumerOrder.groupBy({
          by: ['couponId'],
          where: { couponId: { in: ids }, customerId: req.customer.id },
          _count: { _all: true }
        })
      : [];
    const mine = new Map(mineRows.map((r) => [r.couponId, r._count._all]));

    const available = coupons.filter((c) => {
      if (c.usageLimit != null && (globalUse.get(c.id) ?? 0) >= c.usageLimit) return false;
      if ((mine.get(c.id) ?? 0) >= c.perUserLimit) return false;
      return true;
    });

    return res.status(200).json({
      status: 'success',
      coupons: available.map((c) => ({
        code: c.code,
        title: c.title,
        subtitle: c.subtitle,
        discountType: c.discountType,
        discountValue: money(c.discountValue),
        maxDiscount: money(c.maxDiscount),
        minOrderValue: money(c.minOrderValue),
        validTo: c.validTo,
        shopId: c.shopId,
        industryId: c.industryId,
        // So the app can say "applied automatically" rather than showing a code
        // next to an offer the customer never has to type.
        autoApply: c.autoApply
        // ⚠️ `usageLimit`, `perUserLimit` and the counts are deliberately not
        // sent. How many of an offer remain is the platform's commercial
        // information, and publishing it invites exactly the rush it describes.
      }))
    });
  } catch (error) {
    console.error('List Customer Coupons Error:', error);
    return res.status(500).json({ message: 'Server error loading offers.' });
  }
};
