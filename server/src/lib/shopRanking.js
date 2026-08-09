// Phase 1.2 — which shops can serve a point, and in what order.
//
// This is a library, not controller code, on purpose: the §1.5 reroute sweeper
// re-offers a timed-out order to the *next* candidate and must produce exactly
// the same list the customer's serviceability check produced, without going
// through HTTP. `GET /api/customer/serviceable` is a thin wrapper over it.
//
// Shape of the query: a bounding box on `@@index([role, latitude, longitude])`
// prefilters in the index, then haversine refines inside the circle. A
// `findMany` over every shop would work today and stop working at scale.
import prisma from './prisma.js';
import { boundingBox, isValidLatLng } from './geo.js';
import { sellableQty } from './inventory.js';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';

// Radius is per shop (`User.serviceRadiusKm`); the config value is only the
// fallback for a shop that has not set one. So the bounding box has to be built
// from the widest radius any shop actually uses, not from the default.
async function maxRadiusKm(defaultRadiusKm) {
  const [row] = await prisma.$queryRaw`
    SELECT MAX(COALESCE("serviceRadiusKm", ${defaultRadiusKm}::double precision)) AS max_km
    FROM "User"
    WHERE "role" = 'SHOP' AND "isActive" = true AND "isOpen" = true
  `;
  const max = Number(row?.max_km);
  return Number.isFinite(max) && max > 0 ? max : defaultRadiusKm;
}

/**
 * Serviceable shops for a point, best first.
 *
 * Filter: role=SHOP · active · open · industry (if given) · the customer inside
 * the shop's own `serviceRadiusKm`.
 * Order: `routingPriority` DESC → distance ASC → `fulfilmentRate` DESC.
 * That order is the stockout policy from HANDOFF §3 — a shop that misses orders
 * pays in ranking, not in fines.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number|null} industryId  null matches every industry
 * @param {object} [options]
 * @param {number[]} [options.excludeShopIds] shops already offered this order
 * @param {number} [options.limit]
 * @param {Array<{productId:number, variantId?:number|null, quantity:number}>} [options.requireStock]
 *        keep only shops that can currently sell all of these — what reroute needs
 * @returns {Promise<Array<{id:number, name:string, distanceKm:number, ...}>>}
 */
export async function rankCandidateShops(lat, lng, industryId = null, options = {}) {
  if (!isValidLatLng(lat, lng)) return [];

  const { excludeShopIds = [], limit, requireStock } = options;

  const defaultRadiusKm = await getConfigNumber(CONFIG_KEYS.DEFAULT_RADIUS_KM, industryId);
  const box = boundingBox(lat, lng, await maxRadiusKm(defaultRadiusKm));

  // Haversine in SQL so the radius comparison happens next to the row and only
  // survivors cross the wire.
  const rows = await prisma.$queryRaw`
    SELECT
      u."id", u."name", u."businessName", u."logoUrl", u."coverImageUrl",
      u."rating", u."routingPriority", u."fulfilmentRate", u."industryId",
      u."latitude", u."longitude", u."serviceRadiusKm", u."safetyStockBuffer",
      u."openTime", u."closeTime", u."usesOwnRiders",
      (2 * 6371 * asin(sqrt(
        power(sin(radians(u."latitude" - ${lat}::double precision) / 2), 2) +
        cos(radians(${lat}::double precision)) * cos(radians(u."latitude")) *
        power(sin(radians(u."longitude" - ${lng}::double precision) / 2), 2)
      ))) AS "distanceKm"
    FROM "User" u
    WHERE u."role" = 'SHOP'
      AND u."isActive" = true
      AND u."isOpen" = true
      AND u."latitude" IS NOT NULL
      AND u."longitude" IS NOT NULL
      AND u."latitude" BETWEEN ${box.minLat}::double precision AND ${box.maxLat}::double precision
      AND u."longitude" BETWEEN ${box.minLng}::double precision AND ${box.maxLng}::double precision
      AND (${industryId}::int IS NULL OR u."industryId" = ${industryId}::int)
      AND NOT (u."id" = ANY(${excludeShopIds}::int[]))
    ORDER BY 1
  `;

  const candidates = rows
    .map((r) => ({ ...r, distanceKm: Number(r.distanceKm) }))
    .filter((r) => r.distanceKm <= (r.serviceRadiusKm ?? defaultRadiusKm))
    .sort(
      (a, b) =>
        b.routingPriority - a.routingPriority ||
        a.distanceKm - b.distanceKm ||
        (b.fulfilmentRate ?? 0) - (a.fulfilmentRate ?? 0) ||
        a.id - b.id // stable, so a reroute never oscillates between two equals
    );

  const inStock = requireStock?.length
    ? await filterByStock(candidates, requireStock)
    : candidates;

  return limit ? inStock.slice(0, limit) : inStock;
}

/** Keep only shops whose sellable quantity covers every requested line. */
async function filterByStock(candidates, lines) {
  if (!candidates.length) return [];

  const shopIds = candidates.map((c) => c.id);
  const rows = await prisma.shopInventory.findMany({
    where: {
      shopId: { in: shopIds },
      productId: { in: [...new Set(lines.map((l) => l.productId))] },
      isAvailable: true
    }
  });

  const key = (shopId, productId, variantId) => `${shopId}:${productId}:${variantId ?? 'null'}`;
  const byKey = new Map(rows.map((r) => [key(r.shopId, r.productId, r.variantId), r]));

  return candidates.filter((shop) =>
    lines.every((line) => {
      const row = byKey.get(key(shop.id, line.productId, line.variantId ?? null));
      return sellableQty(row, shop.safetyStockBuffer) >= line.quantity;
    })
  );
}

/**
 * Is there a **platform** rider who could actually pick this up?
 *
 * HANDOFF §3: serviceability is "radius per shop **and** a rider on shift". A
 * shop in range with nobody to collect from it is not serviceable, and telling
 * the customer so up front is cheaper than cancelling later.
 *
 * ⚠️ `employerShopId IS NULL` is the same partition `freeRidersNear` applies,
 * and it has to be here too: a shop's own delivery boy standing in the area is
 * not coverage for anybody else, and counting him would advertise every shop
 * around him as deliverable by a rider who will never be sent to them.
 */
export async function hasRiderCoverage(lat, lng, industryId = null) {
  if (!isValidLatLng(lat, lng)) return false;

  const rangeKm = await getConfigNumber(CONFIG_KEYS.RIDER_RANGE_KM, industryId);
  const box = boundingBox(lat, lng, rangeKm);

  const [row] = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM "User" u
    WHERE u."role" = 'EXECUTIVE'
      AND u."executiveType" = 'DELIVERY'
      AND u."isOnShift" = true
      AND u."isActive" = true
      AND u."employerShopId" IS NULL
      AND u."lastLat" IS NOT NULL
      AND u."lastLng" IS NOT NULL
      AND u."lastLat" BETWEEN ${box.minLat}::double precision AND ${box.maxLat}::double precision
      AND u."lastLng" BETWEEN ${box.minLng}::double precision AND ${box.maxLng}::double precision
      AND (2 * 6371 * asin(sqrt(
        power(sin(radians(u."lastLat" - ${lat}::double precision) / 2), 2) +
        cos(radians(${lat}::double precision)) * cos(radians(u."lastLat")) *
        power(sin(radians(u."lastLng" - ${lng}::double precision) / 2), 2)
      ))) <= ${rangeKm}::double precision
    LIMIT 1
  `;

  return Boolean(row);
}

/**
 * Which of these shops have one of their **own** delivery boys on shift within
 * range of the shop.
 *
 * The platform's coverage is measured from the customer's point, because any
 * rider in the area can be sent to any shop. A shop's own boy is measured from
 * the *shop*, because he is that shop's employee and starts there — and it is
 * the only measurement that makes the launch-scale win real: a shop with its
 * own riders is serviceable in a district where the platform has none.
 *
 * "On shift", not "free". Whether a busy own-rider means the order waits or a
 * platform rider backs it up is HANDOFF §7.8c, and serviceability is not where
 * that gets decided.
 *
 * @returns {Promise<Set<number>>} the ids of the shops that are covered.
 */
export async function shopsWithOwnRiderCoverage(shops, industryId = null) {
  const own = shops.filter((s) => s.usesOwnRiders && isValidLatLng(s.latitude, s.longitude));
  if (!own.length) return new Set();

  const rangeKm = await getConfigNumber(CONFIG_KEYS.RIDER_RANGE_KM, industryId);

  const rows = await prisma.$queryRaw`
    SELECT DISTINCT u."employerShopId" AS "shopId"
    FROM "User" u
    JOIN "User" s ON s."id" = u."employerShopId"
    WHERE u."role" = 'EXECUTIVE'
      AND u."executiveType" = 'DELIVERY'
      AND u."isOnShift" = true
      AND u."isActive" = true
      AND u."lastLat" IS NOT NULL
      AND u."lastLng" IS NOT NULL
      AND u."employerShopId" = ANY(${own.map((s) => s.id)}::int[])
      AND (2 * 6371 * asin(sqrt(
        power(sin(radians(u."lastLat" - s."latitude") / 2), 2) +
        cos(radians(s."latitude")) * cos(radians(u."lastLat")) *
        power(sin(radians(u."lastLng" - s."longitude") / 2), 2)
      ))) <= ${rangeKm}::double precision
  `;

  return new Set(rows.map((r) => r.shopId));
}

/**
 * The candidate list, narrowed to the shops that somebody can actually collect
 * from — which is now two different questions depending on the shop.
 *
 * A shop on the platform pool is deliverable when a RoadMate rider is on shift
 * near the customer. A shop that has switched to its own delivery boys is
 * deliverable when one of *those* is on shift, and a platform rider standing
 * outside does not help it. Both are honest to the customer up front, which is
 * cheaper than cancelling later (§1.2's original reasoning, applied to a second
 * kind of rider).
 *
 * `platformCovered` comes back alongside because the callers report *why* an
 * address is unserviceable, and "no rider" and "no shop" are different answers.
 */
export async function filterDeliverableShops(shops, { lat, lng, industryId = null } = {}) {
  const [platformCovered, ownCovered] = await Promise.all([
    hasRiderCoverage(lat, lng, industryId),
    shopsWithOwnRiderCoverage(shops, industryId)
  ]);

  return {
    platformCovered,
    ownCoveredShopIds: ownCovered,
    deliverable: shops.filter((s) => (s.usesOwnRiders ? ownCovered.has(s.id) : platformCovered))
  };
}

/** The customer-facing projection of a shop. No email, password or bank data. */
export function publicShop(shop) {
  return {
    id: shop.id,
    name: shop.businessName || shop.name,
    logoUrl: shop.logoUrl ?? null,
    coverImageUrl: shop.coverImageUrl ?? null,
    rating: shop.rating ?? null,
    industryId: shop.industryId ?? null,
    openTime: shop.openTime ?? null,
    closeTime: shop.closeTime ?? null,
    ...(shop.distanceKm === undefined
      ? {}
      : { distanceKm: Math.round(shop.distanceKm * 100) / 100 })
  };
}
