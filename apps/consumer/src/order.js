// How a customer reads an order: the ladder it climbs, what each rung means in
// plain words, and the two states that are not rungs at all.
//
// **This draws the ladder that exists**, the same rule the Rider app's
// `src/job.js` follows. `ConsumerOrderStatus` has eight values and the customer
// app shows seven of them as steps; the eighth, `CANCELLED`, is not a step but
// an ending, and it is rendered as one.
//
// The wording is the point of this file. `ROUTING` is not "routing" to somebody
// waiting for lunch — it is "finding a shop that has everything". `READY` is
// not "ready", it is "waiting for your delivery partner". A status vocabulary
// written for a pipeline is not a vocabulary written for the person at the end
// of it, and the pipeline's is the one that must not change.

/** The rungs, in order, for anything that gets delivered. */
export const DELIVERY_LADDER = ['PLACED', 'ROUTING', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED', 'DELIVERED'];

const STAGE = {
  PLACED: {
    title: 'Order placed',
    // Two different reasons an order sits at PLACED, and they are not the same
    // sentence to a customer: an unpaid prepaid order, or a pharmacy order
    // waiting on a verifier. The screen picks between them from the order.
    customer: 'Confirming your order'
  },
  ROUTING: { title: 'Finding a shop', customer: 'Finding a shop that has everything' },
  ACCEPTED: { title: 'Shop accepted', customer: 'A shop has taken your order' },
  PREPARING: { title: 'Being packed', customer: 'Your order is being packed' },
  READY: { title: 'Packed', customer: 'Waiting for your delivery partner' },
  PICKED: { title: 'On the way', customer: 'Your delivery partner is on the way' },
  DELIVERED: { title: 'Delivered', customer: 'Delivered' },
  CANCELLED: { title: 'Cancelled', customer: 'This order was cancelled' }
};

export const stageTitle = (status) => STAGE[status]?.title ?? status;
export const stageMessage = (status) => STAGE[status]?.customer ?? '';

/** Is this order still going somewhere? */
export const isLive = (order) => order?.status !== 'DELIVERED' && order?.status !== 'CANCELLED';

/**
 * The index of the current rung, or -1 for an order that fell off the ladder.
 * A voucher order never climbs it at all — see `isVoucherOrder`.
 */
export const ladderIndex = (status) => DELIVERY_LADDER.indexOf(status);

/**
 * **Was this order rerouted?**
 *
 * More than one `FulfilmentAttempt` means the first shop did not take it — it
 * timed out, rejected, or reported a stockout — and the platform moved it on
 * (HANDOFF §3). The customer is deliberately never told *which* shops declined:
 * the attempts array carries shop ids for offers that were never accepted, and
 * naming a shop that said no is a reputation claim the platform has no business
 * making. What is worth saying is that we kept trying, because the alternative
 * reading of a long ROUTING is that nothing is happening.
 */
export const rerouteCount = (order) => Math.max(0, (order?.attempts?.length ?? 1) - 1);

/**
 * A `NO_DELIVERY` purchase — a gym membership. It has no rider, no address and
 * no ladder; it goes straight to DELIVERED when the voucher is issued, because
 * DELIVERED is what this codebase means by "the sale is final".
 *
 * Detected from the order rather than from the industry, so an order opened
 * from a deep link reads correctly without the industry list having loaded.
 */
export const isVoucherOrder = (order) => Boolean(order?.vouchers?.length) || order?.address === undefined;

/**
 * Fulfilment-type predicates, for choosing a screen's shape only.
 *
 * `isVoucherIndustry` covers **both** self-collected types, mirroring the
 * server's `isVoucherOnly`. Everything that asks it — no address, prepaid-only,
 * a code instead of a rider — wants the same answer for a turf hour as for a gym
 * month. The screens that need to tell them apart ask `isBookingIndustry`.
 */
export const isVoucherIndustry = (fulfilmentType) =>
  fulfilmentType === 'NO_DELIVERY' || fulfilmentType === 'SERVICE_BOOKING';
/** A booked hour: the customer picks a slot, and the code is valid only for it. */
export const isBookingIndustry = (fulfilmentType) => fulfilmentType === 'SERVICE_BOOKING';
export const needsPrescription = (fulfilmentType) => fulfilmentType === 'VERIFY_AND_DELIVER';
export const isCooked = (fulfilmentType) => fulfilmentType === 'COOK_AND_DELIVER';
/** Every type in the enum now has a code path (server `lib/fulfilment.js`). */
export const isOrderable = (fulfilmentType) => fulfilmentType != null;

/** What this industry hands over, in the words its own screens should use. */
export const voucherNoun = (fulfilmentType) =>
  isBookingIndustry(fulfilmentType) ? 'booking' : 'membership';

/**
 * Why an order is stuck at PLACED, in the customer's words — or null if it is
 * not stuck. Both gates are independent and either can be the one outstanding
 * (server §1.9), so this reports the first that applies and the screen shows it.
 */
export function blockedReason(order) {
  if (order?.status !== 'PLACED') return null;
  const prescription = (order.prescriptions ?? [])[0];
  if (prescription?.status === 'REJECTED') {
    return {
      tone: 'danger',
      message: prescription.rejectReason
        ? `Your prescription was not accepted: ${prescription.rejectReason}`
        : 'Your prescription was not accepted.'
    };
  }
  if (prescription && prescription.status !== 'APPROVED') {
    return { tone: 'warning', message: 'A pharmacist is checking your prescription.' };
  }
  // Nothing uploaded yet, on an order that cannot move without one. This gate
  // used to be silent — the order simply sat at PLACED — because there was no
  // way to upload and so nothing useful to say. There is now (2026-08-09).
  if (needsPrescription(order.fulfilmentType) && !prescription) {
    return {
      tone: 'warning',
      message: 'Add a photo of your prescription. A pharmacist checks it before any shop is asked to pack this order.',
      needsUpload: true
    };
  }
  if (order.requiresPayment) {
    return { tone: 'warning', message: 'Waiting for your payment to be confirmed.' };
  }
  return null;
}

/** "12 Sanjay Nagar, Bengaluru" — one line, in the order people say it. */
export function formatAddress(address) {
  if (!address) return '';
  return [address.line1, address.line2, address.landmark, address.city, address.pincode]
    .filter(Boolean)
    .join(', ');
}

/** "in about 35 min", or nothing at all rather than a promise we cannot make. */
export function etaText(order) {
  if (!order?.promisedEtaMin || !isLive(order)) return null;
  return `in about ${order.promisedEtaMin} min`;
}

/** "25 Jul, 9:14 AM" */
export function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * "Sat 22 Aug, 18:00 – 19:00" — a booked hour, in one line.
 *
 * The day is always shown, never "today"/"tomorrow": a booking is usually made
 * days ahead, and a relative word is exactly the kind that goes stale on a
 * screen somebody left open overnight.
 */
export function formatSlot(slot) {
  if (!slot?.startsAt || !slot?.endsAt) return '';
  const from = new Date(slot.startsAt);
  const to = new Date(slot.endsAt);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '';
  const day = from.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const t = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t(from)} – ${t(to)}`;
}

/** "valid till 12 Sep 2026" — vouchers are the one thing with an expiry date. */
export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
