// What a rider earns for a delivery.
//
// Riders are independent delivery partners, not platform employees (HANDOFF §3,
// revised 2026-08-07 — which is also why the ₹2,000/month rider subscription is
// gone rather than relabelled: a platform pays its delivery partners, it does
// not charge them). That makes per-order pay their entire income from a drop,
// and until this file existed there was none: `riderEarning` was written in
// exactly one place, `recordDeadRun()`, so a *successful* delivery recorded
// nothing at all.
//
// The formula is base fare + a per-km rate on the distance beyond a free
// radius. All three numbers are `PlatformConfig` and default to 0, so nothing
// here invents what the client is willing to pay — see `CONFIG_DEFAULTS`.
// Surge and streak incentives are deliberately out of scope for year one.
//
// Like the commission split, the earning is computed once and **frozen onto the
// job at delivery**. Settlement reads that column; it never recomputes. Raising
// rider pay next month must not silently reprice a trip somebody already made.
import { Prisma } from '@prisma/client';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';

/**
 * The pure arithmetic, exported so it can be tested without a database and
 * shown on a rider's earnings screen as a breakdown rather than one number.
 *
 * `distanceKm` may be null — `ensureDeliveryJob` leaves it null when a shop or
 * address has no coordinates — and that pays the base fare rather than throwing.
 * A rider who completed a trip is owed the base fare regardless of what the
 * platform failed to record about it.
 */
export function riderEarningFor({ distanceKm, baseFee, freeKm, perKmFee }) {
  const base = new Prisma.Decimal(baseFee || 0);
  const km = Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : 0;
  const chargeableKm = Math.max(0, km - (Number(freeKm) || 0));
  const distancePay = new Prisma.Decimal(perKmFee || 0).times(chargeableKm);

  return {
    baseFee: base.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    chargeableKm: Math.round(chargeableKm * 100) / 100,
    distancePay: distancePay.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    total: base.plus(distancePay).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  };
}

/**
 * The same thing, with the three rates read from config for this industry.
 *
 * ⚠️ **EVERY rider is paid the same, including a shop's own delivery boy.**
 * Reversed on the client call of 2026-08-09. Until then this returned zero for
 * anybody with an `employerShopId`, on the reasoning that the shop employs and
 * pays that person and RoadMate is not party to it. The client's answer is that
 * the platform pays "everyone" — so a shop's boy earns ₹25 + ₹8/km beyond 2 km
 * exactly like a RoadMate delivery partner, on top of whatever his employer
 * pays him.
 *
 * ⚠️ What that costs, recorded because nothing in the code will ever say it:
 * the platform is now paying for deliveries it does not perform. Combined with
 * `commission_percent` at 0 (same call), a 5 km shop-delivered order collects a
 * flat ₹25 delivery fee and pays out ₹49. See `applyConfirmedConfig.js` for the
 * full arithmetic; the client was shown it and confirmed.
 *
 * The `rider` parameter is kept rather than removed: it is what a per-rider rate
 * or an incentive would key on, and every caller already passes it.
 */
export async function computeRiderEarning(job, industryId = null, rider = null) {
  const [baseFee, freeKm, perKmFee] = await Promise.all([
    getConfigNumber(CONFIG_KEYS.RIDER_BASE_FEE, industryId),
    getConfigNumber(CONFIG_KEYS.RIDER_FREE_KM, industryId),
    getConfigNumber(CONFIG_KEYS.RIDER_PER_KM_FEE, industryId)
  ]);
  return riderEarningFor({ distanceKm: job?.distanceKm, baseFee, freeKm, perKmFee });
}
