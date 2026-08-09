// Phase 1.9 — COOK_AND_DELIVER, which is the smallest of the four branches.
//
// A restaurant order is not a different state machine from a grocery order; it
// is the same one with the kitchen's clock added. So this file produces a
// number — `ConsumerOrder.promisedEtaMin` — and nothing else in the pipeline
// learns that restaurants exist.
//
//     eta = base_eta_min + ceil(distanceKm * eta_min_per_km) + prep
//
// `prep` is 0 for every type but COOK_AND_DELIVER, where it is the shop's own
// `User.prepTimeMin` if it has set one, and the industry's `prep_time_min`
// config row if it has not. Per shop, because a biryani house is not a juice
// bar, and a single global number would be wrong for both.
//
// Every term reads from `PlatformConfig` (per-industry override → global →
// documented default), so none of them is a constant in business logic.
import { haversineKm } from './geo.js';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';
import { needsPrepTime, isVoucherOnly } from './fulfilment.js';

/**
 * Minutes to promise the customer, or null when there is nothing to promise.
 *
 * Null — not 0 — for NO_DELIVERY and for a shop or drop point without
 * coordinates: "no ETA" and "an ETA of zero minutes" are different claims, and
 * only the first one is true.
 *
 * @param {object} args
 * @param {string} args.fulfilmentType  `Industry.fulfilmentType`
 * @param {object} args.shop            shop row (latitude/longitude/prepTimeMin)
 * @param {number} [args.dropLat]       delivery address latitude
 * @param {number} [args.dropLng]
 * @param {number} [args.industryId]    for the per-industry config override
 * @returns {Promise<number|null>}
 */
export async function promisedEtaMinutes({ fulfilmentType, shop, dropLat, dropLng, industryId }) {
  if (isVoucherOnly(fulfilmentType)) return null;
  if (!shop || shop.latitude == null || shop.longitude == null) return null;
  if (!Number.isFinite(dropLat) || !Number.isFinite(dropLng)) return null;

  const [baseMin, minPerKm] = await Promise.all([
    getConfigNumber(CONFIG_KEYS.BASE_ETA_MIN, industryId),
    getConfigNumber(CONFIG_KEYS.ETA_MIN_PER_KM, industryId)
  ]);

  const distanceKm = haversineKm(shop.latitude, shop.longitude, dropLat, dropLng);
  const travel = Math.ceil(distanceKm * minPerKm);
  const prep = await prepMinutesFor({ fulfilmentType, shop, industryId });

  return Math.max(1, Math.round(baseMin) + travel + prep);
}

/**
 * The kitchen's contribution. Zero for every type but COOK_AND_DELIVER — which
 * is exactly why the rest of the pipeline needs no restaurant branch.
 */
export async function prepMinutesFor({ fulfilmentType, shop, industryId }) {
  if (!needsPrepTime(fulfilmentType)) return 0;
  if (Number.isInteger(shop?.prepTimeMin) && shop.prepTimeMin >= 0) return shop.prepTimeMin;
  return Math.round(await getConfigNumber(CONFIG_KEYS.PREP_TIME_MIN, industryId));
}
