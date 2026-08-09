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
