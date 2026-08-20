// SERVICE_BOOKING — the branch that buys an hour instead of a thing.
//
// A turf booking is a gym membership with a calendar bolted on. Everything
// `voucher.js` says about NO_DELIVERY holds here too: no rider, no shelf, no
// address, no `DeliveryJob`, prepaid-only, and the order lands on DELIVERED
// because DELIVERED is what this codebase means by "the sale is final". Read
// that file's header first; this one only covers the difference.
//
// THE DIFFERENCE IS THAT *WHICH HOUR* IS THE GOODS. Two consequences follow, and
// they are the whole of this file:
//
//   1. **A slot is held, not a shelf.** `ServiceSlot.booked` is the same idea as
//      `ShopInventory.reserved` and is claimed the same way — a conditional
//      UPDATE evaluated by Postgres under the row lock, never a read-then-write.
//      Two customers checking out for the last 6pm pitch at the same instant is
//      not a hypothetical; it is the single most likely concurrent write this
//      industry produces, because everybody wants the same evening hours.
//
//   2. **The voucher's validity window IS the slot.** Not "30 days from
//      purchase" — a booking for Saturday 6–7pm is worthless on Sunday and
//      invalid on Friday. This is why `redeemVoucher` needed nothing added to
//      it: its existing `NOT_YET_VALID` and `EXPIRED` answers already mean
//      "you're early" and "that slot has passed" once the window is the slot.
//
// WHAT IS DELIBERATELY NOT HERE: recurring slot templates ("every Saturday
// 6–7pm"), waitlists, and rescheduling. A shop generates a week of slots from
// the Manage Slots screen and that is the whole calendar. Each of those three is
// a real feature with its own screens, and none of them is needed to sell an
// hour — building them now would be guessing at a workflow no turf owner has
// described yet.
import { Prisma } from '@prisma/client';
import prisma from './prisma.js';

/**
 * How far ahead a shop may open slots. A year of hours is 8,760 rows nobody
 * will curate; the cap is what stops a fat-fingered date generating them.
 */
export const MAX_HORIZON_DAYS = 120;

/** Longest single slot. A turf sells hours, not fortnights. */
export const MAX_SLOT_HOURS = 12;

/**
 * A slot the customer may still buy.
 *
 * `startsAt > now` and not `endsAt`: selling the tail of an hour that is already
 * running is a refund conversation, not a sale. A turf that wants to dump a
 * half-finished hour can price a shorter slot.
 */
export const isBookable = (slot, now = new Date()) =>
  Boolean(slot) && slot.isOpen && slot.booked < slot.capacity && slot.startsAt > now;

/** Why this slot cannot be booked — the customer-facing reason, or null. */
export function unbookableReason(slot, now = new Date()) {
  if (!slot) return 'SLOT_NOT_FOUND';
  if (!slot.isOpen) return 'SLOT_CLOSED';
  if (slot.startsAt <= now) return 'SLOT_PASSED';
  if (slot.booked >= slot.capacity) return 'SLOT_FULL';
  return null;
}

/** What the reasons above should say to a human. */
export const SLOT_MESSAGES = {
  SLOT_NOT_FOUND: 'That slot is no longer on the calendar.',
  SLOT_CLOSED: 'That slot has been closed by the venue.',
  SLOT_PASSED: 'That slot has already started. Please pick a later one.',
  SLOT_FULL: 'That slot was just taken. Please pick another one.',
  SLOT_WRONG_SHOP: 'That slot belongs to a different venue.',
  SLOT_REQUIRED: 'Please pick a slot before booking.'
};

/**
 * Hold one place in a slot.
 *
 * THE CLAIM, and the reason this is raw SQL rather than a read then an update:
 * `booked < capacity` has to be evaluated by the database under the row lock, or
 * two checkouts that both read `booked: 0` on a `capacity: 1` slot will both
 * write `booked: 1` and the turf will have sold the same hour twice. Same
 * discipline as §1.4's stock reservation, and for the same reason.
 *
 * @returns {Promise<boolean>} true if a place was taken, false if the slot filled
 *   up (or closed) between the check and here.
 */
export async function holdSlot(tx, slotId, now = new Date()) {
  const updated = await tx.$executeRaw`
    UPDATE "ServiceSlot"
    SET "booked" = "booked" + 1, "updatedAt" = NOW()
    WHERE "id" = ${slotId}
      AND "isOpen" = true
      AND "booked" < "capacity"
      AND "startsAt" > ${now}
  `;
  return updated > 0;
}

/**
 * Give a held place back.
 *
 * Floored at zero in SQL rather than trusted: a release that ran twice must not
 * drive `booked` negative and quietly hand the venue phantom capacity. Releasing
 * a slot that was never held is a no-op, which is what makes this safe to call
 * from a cancellation path that may itself be retried.
 */
export async function releaseSlot(tx, slotId) {
  if (slotId == null) return;
  await tx.$executeRaw`
    UPDATE "ServiceSlot"
    SET "booked" = GREATEST("booked" - 1, 0), "updatedAt" = NOW()
    WHERE "id" = ${slotId}
  `;
}

/**
 * The slot this order booked, validated for placement.
 *
 * Checks it exists, belongs to the shop being ordered from, sells one of the
 * products in the cart, and is still bookable. The shop check is not paranoia:
 * `slotId` arrives from the client, and without it a customer could book a
 * cheap venue's hour against an expensive one's calendar.
 *
 * @returns {Promise<{slot?:object, reason?:string}>}
 */
export async function resolveSlotForPlacement({ slotId, cart, now = new Date() }) {
  if (!slotId) return { reason: 'SLOT_REQUIRED' };

  const slot = await prisma.serviceSlot.findUnique({ where: { id: slotId } });
  if (!slot) return { reason: 'SLOT_NOT_FOUND' };
  if (slot.shopId !== cart.shopId) return { reason: 'SLOT_WRONG_SHOP' };

  // The slot has to be for something in the cart, or the customer is paying for
  // a badminton court and holding a football pitch.
  const cartProductIds = new Set((cart.items ?? []).map((item) => item.productId));
  if (!cartProductIds.has(slot.productId)) return { reason: 'SLOT_WRONG_SHOP' };

  const reason = unbookableReason(slot, now);
  return reason ? { reason } : { slot };
}

/**
 * The window a booking's voucher is valid for: the slot itself.
 *
 * `validFrom` is the start of the hour, not the moment of purchase — a code that
 * scans at the gate two days early is a code that lets somebody onto a pitch
 * somebody else has booked.
 */
export const slotWindow = (slot) => ({ validFrom: slot.startsAt, validTo: slot.endsAt });

/**
 * What a slot costs. `priceOverride` when the shop set one, otherwise whatever
 * the shelf says — a turf that charges the same all week configures nothing.
 */
export const slotPrice = (slot, shelfPrice) =>
  slot?.priceOverride != null ? new Prisma.Decimal(slot.priceOverride) : shelfPrice;

/**
 * The slots a customer may choose from, soonest first.
 *
 * Full and closed slots are **returned, not filtered out**, with `isBookable`
 * false. A calendar showing 6pm and 8pm with no 7pm reads as a bug; a 7pm marked
 * "Booked" reads as a busy venue, which is both true and better for the venue.
 * The customer app greys them; nothing can be bought through one because
 * placement re-checks (`resolveSlotForPlacement`).
 */
export async function listSlots({ shopId, productId, from, to, now = new Date() }) {
  const start = from && from > now ? from : now;
  const slots = await prisma.serviceSlot.findMany({
    where: {
      shopId,
      ...(productId ? { productId } : {}),
      startsAt: { gte: start, ...(to ? { lte: to } : {}) }
    },
    orderBy: [{ startsAt: 'asc' }, { productId: 'asc' }],
    include: { product: { select: { id: true, name: true } } },
    take: 500
  });
  return slots;
}

/** The customer-facing shape. `booked` is not one of the customer's business. */
export const publicSlot = (slot, now = new Date()) => ({
  id: slot.id,
  productId: slot.productId,
  productName: slot.product?.name ?? null,
  variantId: slot.variantId ?? null,
  startsAt: slot.startsAt,
  endsAt: slot.endsAt,
  priceOverride: slot.priceOverride == null ? null : String(slot.priceOverride),
  isBookable: isBookable(slot, now),
  // "2 of 4 left" is what makes somebody book now rather than later, and it is
  // the venue's own scarcity rather than an invented urgency banner.
  placesLeft: Math.max(0, slot.capacity - slot.booked),
  capacity: slot.capacity
});

/** The shop-facing shape — the venue does need to see how full its hours are. */
export const shopSlot = (slot, now = new Date()) => ({
  ...publicSlot(slot, now),
  booked: slot.booked,
  isOpen: slot.isOpen
});
