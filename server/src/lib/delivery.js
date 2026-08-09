// Phase 1.7 — the last mile.
//
// A `DeliveryJob` is created when the shop marks the order READY and assigned to
// the nearest rider who is on shift and not already carrying something. Only
// `LAST_MILE` is built: the designed multi-drop `TRADE_ROUTE` flow waits for B2B
// volume (PLAN §4).
//
// THE RACE HERE IS THE RIDER, NOT THE STOCK. Two orders going READY in the same
// second must not both grab the same rider. A conditional UPDATE on the *job*
// cannot express that — the contended row is the rider — so assignment takes a
// `SELECT ... FOR UPDATE` on the rider before counting their live jobs. That
// serialises every assignment attempt for one rider without locking anybody else.
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { boundingBox } from './geo.js';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';
import { orderLines, releaseLines, closePaymentAsRefundable } from './routing.js';

/** A rider holding any of these is mid-job and may not be given another. */
export const LIVE_JOB_STATUSES = ['ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_DROP'];

/**
 * The handshake at the door. Four digits, from a CSPRNG rather than
 * `Math.random`, because it is the only thing standing between "delivered" and
 * "marked delivered".
 */
const newDeliveryOtp = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/** Straight-line km. Real road distance needs a maps provider nobody has bought yet. */
function straightLineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The job for an order, created once.
 *
 * Idempotent: a shop that taps READY twice, or a re-assignment after a rider goes
 * off shift, must not produce two jobs for one order.
 */
export async function ensureDeliveryJob(tx, order) {
  const existing = await tx.deliveryJob.findFirst({
    where: { consumerOrderId: order.id, type: 'LAST_MILE', status: { not: 'FAILED' } }
  });
  if (existing) return existing;

  const shop = order.shop ?? (await tx.user.findUnique({ where: { id: order.shopId } }));
  const address = order.address ?? (await tx.address.findUnique({ where: { id: order.addressId } }));

  return tx.deliveryJob.create({
    data: {
      type: 'LAST_MILE',
      status: 'UNASSIGNED',
      consumerOrderId: order.id,
      pickupLat: shop?.latitude ?? null,
      pickupLng: shop?.longitude ?? null,
      dropLat: address?.latitude ?? null,
      dropLng: address?.longitude ?? null,
      distanceKm:
        shop?.latitude != null && address?.latitude != null
          ? Math.round(straightLineKm(shop.latitude, shop.longitude, address.latitude, address.longitude) * 100) / 100
          : null,
      otpCode: newDeliveryOtp()
    }
  });
}

/**
 * Riders who could take a pickup at (lat, lng), nearest first.
 *
 * On shift, active, inside `rider_range_km`, and holding no live job. Reads
 * `@@index([role, executiveType, isOnShift])`.
 *
 * THE POOL IS A PARTITION, NOT A PREFERENCE (HANDOFF §3, two delivery modes).
 * `employerShopId` splits every rider in two, and the split is enforced in both
 * directions:
 *
 *   - a shop with `usesOwnRiders` is served **only** by riders it employs;
 *   - the platform pool is **only** riders nobody employs.
 *
 * The second half is the one that bites. A shop's delivery boy left in the
 * platform pool would be offered a rival shop's order — he would be standing in
 * one shop collecting another's goods — so the exclusion is unconditional and
 * does not depend on his employer's `usesOwnRiders` flag being set. A rider
 * belongs to a shop or to the platform; never to both.
 *
 * The status column is cast to text rather than casting the array to the enum:
 * Postgres has no `enum = text` operator, and `::text[]` keeps the parameter a
 * plain string array on the JS side.
 *
 * @param {number|null} employerShopId  the shop whose own riders to draw from,
 *   or null for the platform pool.
 */
async function freeRidersNear(lat, lng, industryId, employerShopId = null) {
  const rangeKm = await getConfigNumber(CONFIG_KEYS.RIDER_RANGE_KM, industryId);
  const box = boundingBox(lat, lng, rangeKm);

  return prisma.$queryRaw`
    SELECT u."id",
      (2 * 6371 * asin(sqrt(
        power(sin(radians(u."lastLat" - ${lat}::double precision) / 2), 2) +
        cos(radians(${lat}::double precision)) * cos(radians(u."lastLat")) *
        power(sin(radians(u."lastLng" - ${lng}::double precision) / 2), 2)
      ))) AS "distanceKm"
    FROM "User" u
    WHERE u."role" = 'EXECUTIVE'
      AND u."executiveType" = 'DELIVERY'
      AND u."isOnShift" = true
      AND u."isActive" = true
      AND u."lastLat" IS NOT NULL
      AND u."lastLng" IS NOT NULL
      AND u."lastLat" BETWEEN ${box.minLat}::double precision AND ${box.maxLat}::double precision
      AND u."lastLng" BETWEEN ${box.minLng}::double precision AND ${box.maxLng}::double precision
      AND u."employerShopId" IS NOT DISTINCT FROM ${employerShopId}::int
      AND NOT EXISTS (
        SELECT 1 FROM "DeliveryJob" j
        WHERE j."riderId" = u."id" AND j."status"::text = ANY(${LIVE_JOB_STATUSES}::text[])
      )
    ORDER BY "distanceKm" ASC
    LIMIT 10
  `;
}

/**
 * Create the job and give it to the nearest free rider.
 *
 * Returns `{ assigned: false, reason: 'NO_RIDER' }` rather than throwing when
 * nobody is available: the goods are packed either way, and an unassigned job is
 * a queue, not a failure. Whoever comes on shift next gets it.
 */
export async function assignRiderIfPossible(orderId) {
  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId },
    include: { shop: true, address: true }
  });
  if (!order || !order.shopId) return { assigned: false, reason: 'NOT_BOUND' };

  const job = await prisma.$transaction((tx) => ensureDeliveryJob(tx, order));
  if (job.riderId) return { assigned: true, jobId: job.id, riderId: job.riderId };

  const pickupLat = job.pickupLat ?? order.shop?.latitude;
  const pickupLng = job.pickupLng ?? order.shop?.longitude;
  if (pickupLat == null || pickupLng == null) return { assigned: false, reason: 'NO_SHOP_LOCATION' };

  // Which pool. A shop that has switched to its own delivery boys draws only
  // from them; everyone else draws only from riders nobody employs. There is
  // deliberately no fallback from one to the other — whether a platform rider
  // backs up a shop whose own boys are all busy is HANDOFF §7.8c and is not
  // ours to guess. Without an answer the job queues UNASSIGNED, which is the
  // same thing that already happens when no rider is on shift.
  const employerShopId = order.shop?.usesOwnRiders ? order.shopId : null;

  const candidates = await freeRidersNear(pickupLat, pickupLng, order.industryId, employerShopId);

  for (const candidate of candidates) {
    const claimed = await prisma.$transaction(async (tx) => {
      // Serialise on the rider row. Everything below re-checks under this lock,
      // so a rider assigned by a concurrent order is seen as busy here.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.id} FOR UPDATE`;

      const busy = await tx.deliveryJob.count({
        where: { riderId: candidate.id, status: { in: LIVE_JOB_STATUSES } }
      });
      if (busy > 0) return null;

      // Employment is re-asserted here, not trusted from the ranking above: a
      // shop can hire or release a rider between the two, and the pool split is
      // the whole point of the feature.
      const stillFree = await tx.user.findFirst({
        where: { id: candidate.id, isOnShift: true, isActive: true, employerShopId }
      });
      if (!stillFree) return null;

      const taken = await tx.deliveryJob.updateMany({
        where: { id: job.id, riderId: null, status: 'UNASSIGNED' },
        data: { riderId: candidate.id, status: 'ASSIGNED', assignedAt: new Date() }
      });
      return taken.count === 1 ? candidate.id : null;
    });

    if (claimed) {
      return {
        assigned: true,
        jobId: job.id,
        riderId: claimed,
        distanceKm: Math.round(Number(candidate.distanceKm) * 100) / 100
      };
    }
  }

  return { assigned: false, reason: 'NO_RIDER', jobId: job.id };
}

/**
 * The stock actually leaves the shop.
 *
 * This is the one place `quantity` goes down. Everything before it only moved
 * `reserved` around, because until the rider walks out the shop still physically
 * holds the goods (§1.4). `reserved` comes down by the same amount in the same
 * statement — decrementing one without the other is how a shelf ends up
 * permanently unsellable.
 *
 * Delivering also resets `consecutiveStockouts`: HANDOFF §3 says *consecutive*,
 * and a fulfilled order is the proof that the streak is over.
 */
export async function decrementShelfOnDelivery(tx, order, now = new Date()) {
  for (const line of orderLines(order)) {
    await tx.$executeRaw`
      UPDATE "ShopInventory"
      SET "quantity" = GREATEST("quantity" - ${line.quantity}, 0),
          "reserved" = GREATEST("reserved" - ${line.quantity}, 0),
          "consecutiveStockouts" = 0,
          "lastConfirmedAt" = ${now}
      WHERE "shopId" = ${order.shopId}
        AND "productId" = ${line.productId}
        AND "variantId" IS NOT DISTINCT FROM ${line.variantId}::int
    `;
  }
}

/**
 * A trip that produced nothing: the rider got there and there was nothing to
 * collect, or nobody to deliver to.
 *
 * HANDOFF §3: the platform pays the rider and the shop is not deducted. The
 * deduction field is built and left at zero, to be switched on in year two —
 * writing it as 0 now is cheaper than adding the column later.
 *
 * ⚠️ Unless the rider is the shop's own employee, in which case the platform
 * pays nothing — the same rule as a successful delivery (`riderPay.js`). A
 * wasted trip between a shop and its own customer is a cost the shop and its
 * employee settle between themselves.
 */
export async function recordDeadRun(tx, { job, order, reason, rider = null, now = new Date() }) {
  const employed =
    rider?.employerShopId != null ||
    (rider == null &&
      job.riderId != null &&
      (await tx.user.findUnique({ where: { id: job.riderId }, select: { employerShopId: true } }))
        ?.employerShopId != null);

  const deadRunFee = employed
    ? new Prisma.Decimal(0)
    : new Prisma.Decimal(await getConfigNumber(CONFIG_KEYS.DEAD_RUN_FEE, order.industryId));

  await tx.deliveryJob.update({
    where: { id: job.id },
    data: {
      status: 'FAILED',
      isDeadRun: true,
      deadRunFee, // the platform's cost
      riderEarning: deadRunFee, // ...and the rider's pay. Never zero for a real trip.
      deliveryNote: reason,
      completedAt: now
    }
  });

  // The goods never left, so the shelf gets its units back.
  await releaseLines(tx, order.shopId, orderLines(order));

  await tx.consumerOrder.update({
    where: { id: order.id },
    data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason }
  });

  await closePaymentAsRefundable(tx, order, now);
}

export { straightLineKm, newDeliveryOtp };
