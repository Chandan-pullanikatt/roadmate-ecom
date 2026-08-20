// Phase 1.9 — NO_DELIVERY: the branch that skips almost everything.
//
// ⚠️ **SERVICE_BOOKING shares every line of this file.** A turf hour and a gym
// month are the same purchase — no rider, no shelf, no address, a code redeemed
// in person, prepaid-only, DELIVERED on issue. They part company at exactly one
// point, the validity window, and `issueVoucher` branches there and nowhere
// else. `lib/booking.js` holds the slot; this file still mints and redeems the
// code for both.
//
// A gym membership is closer to BookMyShow than to Blinkit. There is no rider,
// no shelf to reserve, no address, and no `DeliveryJob`. What the customer buys
// is a `Voucher`; what the shop does is redeem it at the door.
//
// THE ONE DESIGN DECISION HERE: this does NOT go through `advanceOrder()`.
// PLAN §8 is explicit about why, and it is worth restating — routing exists to
// answer "which shop, and what if it says no". A membership has already picked
// its shop (you join *that* gym), so there is no candidate list, no accept
// window, and nothing to reroute to. Forcing it through the routing engine
// would grow that engine a branch exactly one industry ever takes.
//
// WHERE THE ORDER ENDS UP: `DELIVERED`. Not because anything was delivered, but
// because DELIVERED is what this codebase means by "the sale is final" —
// `applyCommissionSplit()` freezes the split there (§1.8) and `runSettlement()`
// pays out from there. Issuing the voucher *is* the fulfilment, so it is the
// moment the money becomes real. Redemption is a later, separate act on the
// `Voucher` row and moves no money.
//
// NO_DELIVERY IS PREPAID-ONLY, and placement enforces it. COD here would mean
// cash handed to the gym's own counter — money that never passes through the
// platform, yet on which the platform would still be booking commission and
// paying a `netPayable` out of funds it never held. That is an accounting hole,
// not a feature; see PLAN §7.
import crypto from 'node:crypto';
import prisma from './prisma.js';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';
import { applyCommissionSplit } from './settlement.js';
import { isVoucherOnly, isBooking } from './fulfilment.js';
import { slotWindow } from './booking.js';

// No 0/O/1/I/L — these codes get read aloud at a counter and typed by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomCode = () => {
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `RM-${out.slice(0, 5)}-${out.slice(5)}`;
};

const orderInclude = {
  industry: true,
  payment: true,
  vouchers: true,
  // The booked hour, which *is* the validity window for SERVICE_BOOKING.
  slot: true,
  // `variant` is included for its `validityDays` — see `validityDaysFor()`.
  items: { include: { variant: true } }
};

/**
 * How long this membership lasts, in days.
 *
 * The shop sets price *and* duration (client answer, 2026-08-07), and both live
 * on the thing the customer actually bought: price on `ShopInventory.sellingPrice`
 * per variant, duration on `ProductVariant.validityDays`. `voucher_validity_days`
 * is now what it should always have been — a fallback for a variant that does not
 * say, rather than the platform deciding a commercial term on the gym's behalf
 * (PLAN §7.4: it was the one invented number in the codebase).
 *
 * One order gets one voucher, so a multi-line order takes the **longest**
 * validity on it. Cutting a customer's annual membership down to a 30-day line
 * they bought alongside it is the failure worth avoiding; the reverse costs the
 * gym a month it was already willing to sell.
 */
function validityDaysFor(order, fallbackDays) {
  const declared = (order.items ?? [])
    .map((item) => item.variant?.validityDays)
    .filter((d) => Number.isInteger(d) && d > 0);
  return declared.length ? Math.max(...declared) : fallbackDays;
}

/**
 * Issue the voucher for a paid NO_DELIVERY order.
 *
 * Called from `beginRouting()` — the same single entry point §1.8's webhook
 * already uses for "the money landed, proceed". The caller does not need to
 * know which branch it is triggering.
 *
 * Idempotent by claim, like everything else in this pipeline: the transition
 * out of PLACED is a conditional `updateMany`, so a replayed webhook that gets
 * past §1.8's payment claim still cannot mint a second voucher.
 *
 * @returns {Promise<{issued:boolean, reason?:string, voucher?:object}>}
 */
export async function issueVoucher(orderId, now = new Date()) {
  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId },
    include: orderInclude
  });

  if (!order) return { issued: false, reason: 'NO_ORDER' };
  if (!isVoucherOnly(order.industry?.fulfilmentType)) return { issued: false, reason: 'NOT_VOUCHER_ORDER' };
  if (order.status !== 'PLACED') return { issued: false, reason: 'ALREADY_HANDLED' };
  if (order.payment?.status !== 'PAID') return { issued: false, reason: 'AWAITING_PAYMENT' };

  // WHERE THE VALIDITY WINDOW COMES FROM, and it is the one thing the two
  // self-collected types disagree about.
  //
  //   NO_DELIVERY     a duration from the moment of purchase. A month's
  //                   membership starts when you buy it.
  //   SERVICE_BOOKING the slot, exactly. A booking for Saturday 6–7pm is
  //                   worthless on Sunday and must not open the gate on Friday,
  //                   so `validFrom` is the start of the hour and not now.
  //
  // Both then flow into the same `Voucher` row and the same `redeemVoucher`,
  // whose existing NOT_YET_VALID / EXPIRED answers become "you're early" and
  // "that slot has passed" without a line being added to it.
  let validFrom = now;
  let validTo;
  if (isBooking(order.industry?.fulfilmentType)) {
    // A booking without its slot cannot be given a window, and inventing one
    // would mint a code valid at a time nobody sold.
    if (!order.slot) return { issued: false, reason: 'NO_SLOT' };
    ({ validFrom, validTo } = slotWindow(order.slot));
  } else {
    const fallbackDays = await getConfigNumber(CONFIG_KEYS.VOUCHER_VALIDITY_DAYS, order.industryId);
    const validityDays = validityDaysFor(order, fallbackDays);
    validTo = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  }

  return prisma.$transaction(async (tx) => {
    // THE CLAIM. Same discipline as §1.5's attempt claim and §1.8's payment
    // claim: whoever moves the order out of PLACED owns the issuance.
    const claimed = await tx.consumerOrder.updateMany({
      where: { id: orderId, status: 'PLACED' },
      data: { status: 'DELIVERED', deliveredAt: now }
    });
    if (claimed.count === 0) return { issued: false, reason: 'LOST_RACE' };

    // The sale is final, so the split freezes now — identical to what delivery
    // does in §1.8, and read the same way by `runSettlement()` afterwards.
    await applyCommissionSplit(tx, order);

    const voucher = await createUniqueVoucher(tx, { order, validFrom, validTo });
    return { issued: true, voucher };
  });
}

/**
 * `Voucher.code` is `@unique`, so a collision is a real (if vanishingly rare)
 * outcome and not something to pretend away — retry rather than 500 on it.
 */
async function createUniqueVoucher(tx, { order, validFrom, validTo }, attempt = 0) {
  const code = randomCode();
  try {
    return await tx.voucher.create({
      data: {
        code,
        // What the shop's scanner reads. A deep link, not a bare code, so the
        // Business app can open straight onto the redemption screen.
        qrPayload: `roadmate://voucher/${code}`,
        validFrom,
        validTo,
        consumerOrderId: order.id
      }
    });
  } catch (error) {
    if (error?.code === 'P2002' && attempt < 3) {
      return createUniqueVoucher(tx, { order, validFrom, validTo }, attempt + 1);
    }
    throw error;
  }
}

/**
 * Redeem a voucher at the counter.
 *
 * Redemption is a claim too — `redeemedAt: null` is re-asserted in the WHERE
 * clause, so a double tap, or two staff scanning the same QR at once, redeems
 * exactly once. Count 0 is "already used", never a retry.
 *
 * Only the shop that sold the membership may redeem it: the voucher's order
 * carries `shopId`, bound at placement (a NO_DELIVERY order is never rerouted).
 *
 * @returns {Promise<{redeemed:boolean, reason?:string, voucher?:object}>}
 */
export async function redeemVoucher({ code, shopId, now = new Date() }) {
  const voucher = await prisma.voucher.findUnique({
    where: { code },
    include: { consumerOrder: true }
  });

  if (!voucher) return { redeemed: false, reason: 'NOT_FOUND' };
  if (voucher.consumerOrder.shopId !== shopId) return { redeemed: false, reason: 'WRONG_SHOP' };
  if (voucher.redeemedAt) return { redeemed: false, reason: 'ALREADY_REDEEMED' };
  if (now < voucher.validFrom) return { redeemed: false, reason: 'NOT_YET_VALID' };
  if (now > voucher.validTo) return { redeemed: false, reason: 'EXPIRED' };

  const claimed = await prisma.voucher.updateMany({
    where: {
      id: voucher.id,
      redeemedAt: null,
      validFrom: { lte: now },
      validTo: { gte: now }
    },
    data: { redeemedAt: now, redeemedByShopId: shopId }
  });
  if (claimed.count === 0) return { redeemed: false, reason: 'ALREADY_REDEEMED' };

  return {
    redeemed: true,
    voucher: await prisma.voucher.findUnique({ where: { id: voucher.id } })
  };
}

/** The customer-facing shape. The QR payload is the customer's to show. */
export const publicVoucher = (v) => ({
  code: v.code,
  qrPayload: v.qrPayload,
  validFrom: v.validFrom,
  validTo: v.validTo,
  redeemedAt: v.redeemedAt,
  isRedeemed: Boolean(v.redeemedAt)
});
