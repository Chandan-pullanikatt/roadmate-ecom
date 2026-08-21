// Address search — the one place that talks to a maps provider.
//
// WHY THIS IS A LIBRARY AND NOT INLINE IN A CONTROLLER
//
// Two reasons, and the second is the expensive one.
//
// 1. **The provider is a decision, not a fact.** Google is what every Indian
//    quick-commerce app runs on today and what this file implements, but Ola
//    moved off it in 2024 purely on cost and Mappls exists for the same reason.
//    Everything provider-shaped lives below `--- google ---`; the three exported
//    functions and the shape they return are the contract the app codes against.
//    Swapping providers is rewriting one section of one file.
//
// 2. **The key must never reach the phone.** A Places key embedded in an APK is
//    extractable with `unzip` and a text editor, and it bills to your card until
//    somebody notices. Android *Maps SDK* keys have to ship in the app and are
//    defended by package-name + signing-certificate restriction; Places keys do
//    not have to, so they must not. That is the whole reason the app asks this
//    server instead of asking Google directly, and it is why these are two
//    separate keys with two separate restrictions:
//
//      GOOGLE_MAPS_API_KEY            server-only, this file, restrict by IP
//      app.json googleMaps.apiKey     ships in the APK, restrict by package+SHA-1
//
// ── SESSION TOKENS, WHICH ARE A BILLING MECHANISM ───────────────────────────
//
// Google bills autocomplete per *request* unless the requests are grouped into a
// session that ends with a Details call — then the whole session is billed once.
// The client mints a token per address-entry attempt and passes it to both
// `searchPlaces` and `placeDetails`. Dropping it silently multiplies the bill by
// however many characters a customer types, which is exactly the kind of cost
// bug that surfaces a month later on an invoice.
import { setTimeout as delay } from 'node:timers/promises';

const PLACES_BASE = 'https://places.googleapis.com/v1';
const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';

/** India only. The platform does not deliver anywhere else, so nor should search. */
const REGION = 'in';

const apiKey = () => process.env.GOOGLE_MAPS_API_KEY || '';

/** Whether address search is configured at all — the app asks so it can hide the box. */
export const placesConfigured = () => Boolean(apiKey());

/**
 * One fetch with a timeout and a single retry.
 *
 * A customer is typing while this runs, so a hung socket is worse than a fast
 * failure. The retry covers exactly one thing — a transient 5xx from Google —
 * and never retries a 4xx, which would be our own bad request sent twice.
 */
async function call(url, init = {}, attempt = 0) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (res.status >= 500 && attempt === 0) {
      await delay(200);
      return call(url, init, attempt + 1);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error?.message || `HTTP ${res.status}`);
    }
    return body;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

// --- google ------------------------------------------------------------------

/**
 * Type-ahead suggestions for a partial address.
 *
 * `locationBias` is a soft nudge, not a filter: biasing to the customer's own
 * neighbourhood is what makes "MG Road" mean the one in their city, while still
 * letting them find an address in another state to send a gift to.
 *
 * @returns {Promise<Array<{placeId:string, title:string, subtitle:string}>>}
 */
export async function searchPlaces(input, { sessionToken, lat, lng } = {}) {
  if (!placesConfigured()) return [];
  const query = String(input || '').trim();
  if (query.length < 3) return [];

  const body = {
    input: query,
    includedRegionCodes: [REGION],
    sessionToken: sessionToken || undefined
  };

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 50000 }
    };
  }

  const data = await call(`${PLACES_BASE}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey() },
    body: JSON.stringify(body)
  });

  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      placeId: p.placeId,
      title: p.structuredFormat?.mainText?.text || p.text?.text || query,
      subtitle: p.structuredFormat?.secondaryText?.text || ''
    }));
}

/**
 * Turn a chosen suggestion into coordinates and a filled-in address.
 *
 * The field mask is not an optimisation — Google bills Details by which fields
 * you ask for, and requesting the whole place costs several times what the five
 * fields this screen actually uses do.
 */
export async function placeDetails(placeId, { sessionToken } = {}) {
  if (!placesConfigured()) return null;

  const url = new URL(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`);
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

  const data = await call(url.toString(), {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'id,location,formattedAddress,addressComponents,displayName'
    }
  });

  return shape({
    latitude: data.location?.latitude,
    longitude: data.location?.longitude,
    formattedAddress: data.formattedAddress,
    components: data.addressComponents || [],
    name: data.displayName?.text
  });
}

/**
 * Coordinates → an address, for after the customer drags the pin.
 *
 * Deliberately server-side rather than `expo-location`'s on-device
 * `reverseGeocodeAsync`. That one is a Play Services component: absent on
 * no-GMS devices, silently rate-limited, and materially worse on Indian
 * addresses. Having dragged the pin to their own door, a customer should not
 * then be told the street is unknown because their phone shipped without Google.
 */
export async function reverseGeocode(lat, lng) {
  if (!placesConfigured()) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const url = new URL(GEOCODE_BASE);
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('region', REGION);
  url.searchParams.set('key', apiKey());

  const data = await call(url.toString());

  // ⚠️ The Geocoding API answers **HTTP 200 when it refuses you**, and puts the
  // refusal in a `status` field. REQUEST_DENIED for a key without the API
  // enabled, OVER_QUERY_LIMIT for a cap, INVALID_REQUEST for bad input — all of
  // them 200 with an empty `results`. Read literally that is indistinguishable
  // from "this spot has no address", so the failure disappears and the screen
  // shows empty fields instead of a reason. Anything but OK or ZERO_RESULTS is
  // an error and is thrown as one.
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`${data.status}${data.error_message ? ': ' + data.error_message : ''}`);
  }

  const first = data.results?.[0];
  if (!first) return null;

  return shape({
    latitude: lat,
    longitude: lng,
    formattedAddress: first.formatted_address,
    // The Geocoding API spells components in snake_case and Places (New) in
    // camelCase. Normalised here so `shape` has one vocabulary to read.
    components: (first.address_components || []).map((c) => ({
      types: c.types,
      longText: c.long_name,
      shortText: c.short_name
    }))
  });
}

// --- shared shape ------------------------------------------------------------

const pick = (components, type) =>
  components.find((c) => (c.types || []).includes(type))?.longText || '';

/**
 * The one address shape the app understands, whichever call produced it.
 *
 * Maps Google's component vocabulary onto this product's five fields. `line1`
 * prefers a building name over a bare street number, because that is what an
 * Indian address is usually known by, and `city` falls back through the three
 * levels Google uses inconsistently between metros and smaller towns.
 */
function shape({ latitude, longitude, formattedAddress, components = [], name }) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const street = [pick(components, 'street_number'), pick(components, 'route')]
    .filter(Boolean)
    .join(' ');

  return {
    latitude,
    longitude,
    formattedAddress: formattedAddress || '',
    line1: name && name !== street ? name : street,
    line2:
      pick(components, 'sublocality_level_1') ||
      pick(components, 'sublocality') ||
      pick(components, 'neighborhood'),
    city:
      pick(components, 'locality') ||
      pick(components, 'administrative_area_level_3') ||
      pick(components, 'administrative_area_level_2'),
    pincode: pick(components, 'postal_code')
  };
}
