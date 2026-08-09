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
//
// SERVICE_BOOKING exists in the enum (the Partner design's "Manage Slots") but
// has no code path yet — it is not part of Phase 1. `isSupported()` is what
// stops an order being placed into that gap silently.
import prisma from './prisma.js';

export const FULFILMENT = {
  PICK: 'PICK_AND_DELIVER',
  COOK: 'COOK_AND_DELIVER',
  VERIFY: 'VERIFY_AND_DELIVER',
  NONE: 'NO_DELIVERY',
  BOOKING: 'SERVICE_BOOKING'
};

/** The types Phase 1 can actually fulfil. */
const SUPPORTED = new Set([FULFILMENT.PICK, FULFILMENT.COOK, FULFILMENT.VERIFY, FULFILMENT.NONE]);

export const isSupported = (type) => SUPPORTED.has(type);

/** A voucher purchase: no rider, no stock, no address, no DeliveryJob. */
export const isVoucherOnly = (type) => type === FULFILMENT.NONE;

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
