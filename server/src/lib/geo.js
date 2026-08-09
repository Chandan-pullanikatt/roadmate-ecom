// Distance maths shared by serviceability, ranking and rider assignment.
//
// Flat-earth approximations are fine at the scales here (a service radius is
// 5-20 km), but haversine is cheap and removes the question entirely.

export const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

const KM_PER_DEGREE_LAT = 110.574;

/**
 * A latitude/longitude box that fully contains `radiusKm` around a point.
 *
 * This is the index-friendly prefilter: `@@index([role, latitude, longitude])`
 * can serve the BETWEEN clauses, and the haversine then refines what survives.
 * A box is always larger than the circle it bounds, so it never drops a row
 * that should have matched.
 */
export function boundingBox(lat, lng, radiusKm) {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  // cos() collapses toward the poles; clamp so a near-polar point cannot
  // produce an infinite longitude span.
  const kmPerDegreeLng = Math.max(111.32 * Math.cos(toRad(lat)), 0.1);
  const dLng = radiusKm / kmPerDegreeLng;

  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng
  };
}

/** True for a real, in-range WGS84 pair. Rejects NaN, strings and nulls. */
export function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Parse `?lat=&lng=` into numbers, or null if either is missing/invalid. */
export function parseLatLng(rawLat, rawLng) {
  const lat = Number.parseFloat(rawLat);
  const lng = Number.parseFloat(rawLng);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/**
 * The widest a single shop may be asked to serve, in km.
 *
 * Not a `PlatformConfig` row: this is not a tunable commercial number, it is the
 * point past which `boundingBox` stops being a useful prefilter and a "nearby
 * shop" stops being nearby. `service_radius_km`'s config row remains the
 * *default* for a shop that has not been given one — this is only the ceiling on
 * what a human may type into the field.
 */
export const MAX_SERVICE_RADIUS_KM = 50;

/**
 * Parse a service radius. Returns `{ ok: true, value }`, or `{ ok: false }` for
 * anything that is not a positive number within the ceiling.
 *
 * A radius of 0 is refused rather than accepted as "delivers nowhere": a shop
 * that should not be routed to has `isOpen`, which says so out loud. A silent 0
 * would look like a configured shop that no customer can ever reach — the exact
 * failure that NULL coordinates used to produce.
 */
export function parseServiceRadiusKm(raw) {
  const km = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(km) || km <= 0 || km > MAX_SERVICE_RADIUS_KM) return { ok: false };
  return { ok: true, value: km };
}
