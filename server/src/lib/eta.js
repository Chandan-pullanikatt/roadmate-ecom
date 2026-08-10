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
 * The same number for a *list* of shops — the "20–39 Minutes" line on every card
 * in the design's Popular Shops list (the storefront pass, 2026-08-10).
 *
 * **Why this exists rather than a loop over `promisedEtaMinutes`.** That
 * function reads two config rows and, for a restaurant, a third — per call. The
 * home screen ranks up to 20 shops and polls every 60 seconds, so the naive loop
 * is 40–60 database round-trips per customer per minute to compute a number that
 * only varies by distance. This reads the config **once** and does the
 * arithmetic per shop. It is the same formula, deliberately: an ETA shown on the
 * card that disagrees with the one promised at placement is the platform
 * contradicting itself two taps apart.
 *
 * Prep time is the one term that is genuinely per shop (`User.prepTimeMin`), so
 * it is read from the row that is already in memory and only falls back to the
 * industry's config row — one extra read, and only for COOK_AND_DELIVER.
 *
 * @returns {Promise<Map<number, number|null>>} shop id → minutes, null where
 *   there is nothing to promise. Never 0: see `promisedEtaMinutes`.
 */
export async function etaMinutesForShops(shops, { fulfilmentType, dropLat, dropLng, industryId }) {
  const out = new Map();
  if (!Array.isArray(shops) || shops.length === 0) return out;

  // Nothing to promise for a membership, or without a drop point. Answered once
  // for the whole list rather than per shop, because neither term is per shop.
  if (isVoucherOnly(fulfilmentType) || !Number.isFinite(dropLat) || !Number.isFinite(dropLng)) {
    for (const shop of shops) out.set(shop.id, null);
    return out;
  }

  const [baseMin, minPerKm, industryPrep] = await Promise.all([
    getConfigNumber(CONFIG_KEYS.BASE_ETA_MIN, industryId),
    getConfigNumber(CONFIG_KEYS.ETA_MIN_PER_KM, industryId),
    needsPrepTime(fulfilmentType)
      ? getConfigNumber(CONFIG_KEYS.PREP_TIME_MIN, industryId)
      : Promise.resolve(0)
  ]);

  for (const shop of shops) {
    if (shop?.latitude == null || shop?.longitude == null) {
      out.set(shop.id, null);
      continue;
    }
    const prep = needsPrepTime(fulfilmentType)
      ? Number.isInteger(shop.prepTimeMin) && shop.prepTimeMin >= 0
        ? shop.prepTimeMin
        : Math.round(industryPrep)
      : 0;
    const distanceKm = haversineKm(shop.latitude, shop.longitude, dropLat, dropLng);
    out.set(shop.id, Math.max(1, Math.round(baseMin) + Math.ceil(distanceKm * minPerKm) + prep));
  }

  return out;
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
