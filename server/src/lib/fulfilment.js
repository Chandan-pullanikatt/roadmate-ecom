// Phase 1.9 — the fulfilment-type branches.
//
// `Industry.fulfilmentType` is the whole switch. Everything §1.9 does derives
// from it, and this file is where the derivation lives so no controller ever
// spells out a string comparison against an enum value.
//
// The four branches, and how much each actually changes:
//
//   PICK_AND_DELIVER    the path §1.2–1.8 built. Nothing here touches it.
//   COOK_AND_DELIVER    prep time folded into `promisedEtaMin`. A number, not
//                       a state machine (see `eta.js`).
//   VERIFY_AND_DELIVER  a gate *before* routing: a prescription must be
//                       APPROVED before the order reaches any shop's inbox.
//                       Reuses §1.8's hook exactly — a PLACED order with its
//                       attempt row parked, made live by `beginRouting()`.
//   NO_DELIVERY         a different shape, deliberately not forced through
//                       `advanceOrder()`. No rider, no stock, no address, no
//                       DeliveryJob: a `Voucher` is issued and later redeemed
//                       in person (see `voucher.js`).
//   SERVICE_BOOKING     NO_DELIVERY plus a calendar. An hour of a turf is the
//                       same purchase as a membership — no rider, no shelf, no
//                       address, a code redeemed at the gate — except that
//                       *which* hour is the thing being bought, so a
//                       `ServiceSlot` is held at placement and the voucher's
//                       validity window is that slot (see `booking.js`).
import prisma from './prisma.js';

export const FULFILMENT = {
  PICK: 'PICK_AND_DELIVER',
  COOK: 'COOK_AND_DELIVER',
  VERIFY: 'VERIFY_AND_DELIVER',
  NONE: 'NO_DELIVERY',
  BOOKING: 'SERVICE_BOOKING'
};

/**
 * The types this platform can actually fulfil.
 *
 * Every enum value is now in here. The set stays because it is the guard that
 * stopped SERVICE_BOOKING orders being placed into a gap silently for two
 * phases, and the next type added to the enum should hit the same wall rather
 * than half-work.
 */
const SUPPORTED = new Set([
  FULFILMENT.PICK,
  FULFILMENT.COOK,
  FULFILMENT.VERIFY,
  FULFILMENT.NONE,
  FULFILMENT.BOOKING
]);

export const isSupported = (type) => SUPPORTED.has(type);

/**
 * A voucher purchase: no rider, no stock, no address, no DeliveryJob.
 *
 * Both self-collected types answer true. Everything that asks this question —
 * the ETA (nothing to promise), `isDelivered` (no reservation, no rider), the
 * placement branch (no address) — wants the same answer for a turf hour as for
 * a gym month. The one place they differ is where the validity window comes
 * from, and that asks `isBooking` instead.
 */
export const isVoucherOnly = (type) => type === FULFILMENT.NONE || type === FULFILMENT.BOOKING;

/** A booked hour: `ConsumerOrder.slotId` is required, and the slot is the validity. */
export const isBooking = (type) => type === FULFILMENT.BOOKING;

/**
 * Money the platform must actually hold before it books commission on it.
 *
 * Both self-collected types are prepaid-only, and for one reason: the goods are
 * handed over at the seller's own counter, so "cash on delivery" here is cash
 * the platform never touches — yet it would still be freezing a commission
 * split and paying a `netPayable` out of funds it never held. That is an
 * accounting hole, not a payment option (PLAN §7).
 */
export const isPrepaidOnly = (type) => isVoucherOnly(type);

/** Kitchen time counts toward the promised ETA. */
export const needsPrepTime = (type) => type === FULFILMENT.COOK;

/** A prescription must be APPROVED before this order may be offered to a shop. */
export const needsPrescription = (type) => type === FULFILMENT.VERIFY;

/**
 * Everything except NO_DELIVERY moves physical stock from a shelf and needs a
 * rider, an address and a reservation. This one predicate is what §1.4's
 * placement branches on.
 */
export const isDelivered = (type) => !isVoucherOnly(type);

/** `Industry.fulfilmentType`, or null if the industry does not exist. */
export async function fulfilmentTypeOf(industryId) {
  if (industryId == null) return null;
  const industry = await prisma.industry.findUnique({
    where: { id: industryId },
    select: { fulfilmentType: true }
  });
  return industry?.fulfilmentType ?? null;
}
