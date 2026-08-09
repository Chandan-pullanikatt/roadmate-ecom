// What a delivery job *is*, as the screens need to read it.
//
// One table, for the same reason `apps/business/src/roles.js` is one table: the
// alternative is every screen spelling out its own status comparison and two of
// them disagreeing.
//
// ⚠️ **The API has three fewer steps than the enum does.** `DeliveryJobStatus`
// carries `EN_ROUTE_PICKUP` and `AT_PICKUP`, but no endpoint sets either —
// `pickUp()` accepts a job in any of `ASSIGNED` / `EN_ROUTE_PICKUP` /
// `AT_PICKUP` and moves it straight to `EN_ROUTE_DROP`. So the real ladder a
// rider walks is two rungs:
//
//     ASSIGNED ──[Picked up]──▶ EN_ROUTE_DROP ──[Deliver + OTP]──▶ DELIVERED
//                     │                              │
//                     └──────────[Dead run]──────────┴──▶ FAILED
//
// The screens are built against **that**, not against the enum. A button whose
// endpoint does not exist is worse than a missing one: it fails in a rider's
// hand at the shop counter. If the two middle statuses ever get endpoints, this
// file is where the ladder grows a rung.

/** Statuses that mean this job is still the rider's problem. */
export const LIVE_STATUSES = ['ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_DROP'];

export const isLive = (job) => LIVE_STATUSES.includes(job?.status);

/** Has the rider collected the bag? The one thing that splits the two rungs. */
export const hasCollected = (job) => job?.status === 'EN_ROUTE_DROP';

/**
 * What the rider is being asked to do next, in their words.
 *
 * `null` means the job is finished and there is no action left — which is what
 * the detail screen shows a delivered job instead of a disabled button.
 */
export function nextStep(job) {
  if (!job) return null;
  if (job.status === 'ASSIGNED' || job.status === 'EN_ROUTE_PICKUP' || job.status === 'AT_PICKUP') {
    return {
      key: 'pickup',
      label: 'I have collected it',
      // The shop has to have finished packing first. Saying so up front is the
      // difference between a rider waiting at the counter and a rider tapping a
      // button that 409s.
      hint: 'Tap once the shop hands the order over.'
    };
  }
  if (job.status === 'EN_ROUTE_DROP') {
    return {
      key: 'deliver',
      label: 'Delivered — enter OTP',
      hint: 'Ask the customer for their 4-digit code.'
    };
  }
  return null;
}

/** The status, in a rider's vocabulary rather than the enum's. */
export function jobStatusLabel(job) {
  if (job?.isDeadRun) return 'Dead run';
  switch (job?.status) {
    case 'UNASSIGNED':
      return 'Waiting for a rider';
    case 'ASSIGNED':
    case 'EN_ROUTE_PICKUP':
    case 'AT_PICKUP':
      return 'Collect from shop';
    case 'EN_ROUTE_DROP':
      return 'Out for delivery';
    case 'DELIVERED':
      return 'Delivered';
    case 'FAILED':
      return 'Closed';
    default:
      return job?.status ?? '—';
  }
}

/** Pill colour. Amber while something is owed, green when it is done. */
export function jobStatusTone(job) {
  if (job?.isDeadRun) return 'danger';
  switch (job?.status) {
    case 'DELIVERED':
      return 'success';
    case 'EN_ROUTE_DROP':
      return 'info';
    case 'FAILED':
      return 'neutral';
    default:
      return 'warning';
  }
}

/** The drop address on one line, in the order somebody reads it out loud. */
export function formatAddress(drop) {
  if (!drop) return '';
  return [drop.line1, drop.line2, drop.landmark, drop.city, drop.pincode].filter(Boolean).join(', ');
}

/**
 * A maps URL for a point.
 *
 * A `geo:` intent would open the rider's preferred app directly, but it is
 * Android-only and silently does nothing where it is unsupported. The universal
 * Google Maps URL opens the installed app on both platforms and degrades to the
 * browser, which is the behaviour a rider on an unfamiliar street needs.
 */
export function mapsUrl(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  // Coordinates, never the typed address: the platform routed this order by
  // latitude and longitude, and a text search can land a rider at a
  // similarly-named road on the other side of the city.
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

/** `tel:` for the shop. A rider who cannot find the counter phones it. */
export const telUrl = (phone) => (phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null);
