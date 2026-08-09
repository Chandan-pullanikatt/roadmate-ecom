// Phase 1.7 — the rider's endpoints.
//
// Shift, location, job list, pickup, delivery, dead run. Assignment is not here:
// it happens when the shop marks the order READY (`lib/delivery.js`), because a
// rider should never have to poll for work.
//
// Delivery is verified by the OTP the customer reads out. That check is the only
// thing separating "delivered" and "marked delivered", so it is not optional and
// not a query parameter — a wrong code is a 422 and the order does not move.
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { isValidLatLng } from '../lib/geo.js';
import { toMoney } from '../lib/cart.js';
import {
  LIVE_JOB_STATUSES,
  decrementShelfOnDelivery,
  recordDeadRun,
  assignRiderIfPossible
} from '../lib/delivery.js';
import { applyCommissionSplit } from '../lib/settlement.js';
import { computeRiderEarning } from '../lib/riderPay.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';
import { isOurAsset } from '../lib/cloudinary.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const str = (raw, max = 300) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null);

/**
 * A proof-of-delivery URL, or null if none was sent. Returns `false` — distinct
 * from null — when one was sent that we did not authorise, so `deliver()` can
 * refuse rather than quietly store it.
 *
 * Both fields have always been accepted here (Phase 1.7) and were unusable
 * until file storage landed. Now that they are real, an arbitrary URL in a
 * proof-of-delivery column is a link the platform will show back to somebody as
 * evidence, pointing anywhere. ⚠️ Without Cloudinary credentials `isOurAsset`
 * passes anything — the stub path every third-party library here takes.
 */
const podUrl = (raw, kind) => {
  const value = str(raw, 2048);
  if (value === null) return null;
  return isOurAsset(value, kind) ? value : false;
};

/** Guard for every route below. `protect` proves staff; this proves *rider*. */
export const requireRider = (req, res, next) => {
  if (req.user?.role !== 'EXECUTIVE' || req.user?.executiveType !== 'DELIVERY') {
    return res.status(403).json({ message: 'This endpoint is for delivery partners.' });
  }
  next();
};

const jobInclude = {
  consumerOrder: { include: { items: true, payment: true, address: true, shop: true } }
};

/** The job card from the Delivery Partner design. */
function jobView(job) {
  const order = job.consumerOrder;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    assignedAt: job.assignedAt,
    distanceKm: job.distanceKm,
    riderEarning: job.riderEarning == null ? null : toMoney(job.riderEarning),
    isDeadRun: job.isDeadRun,

    pickup: order?.shop
      ? {
          shopId: order.shop.id,
          name: order.shop.businessName || order.shop.name,
          phone: order.shop.phone ?? null,
          latitude: job.pickupLat,
          longitude: job.pickupLng
        }
      : null,

    drop: order?.address
      ? {
          line1: order.address.line1,
          line2: order.address.line2,
          landmark: order.address.landmark,
          city: order.address.city,
          pincode: order.address.pincode,
          latitude: job.dropLat,
          longitude: job.dropLng
        }
      : null,

    order: order
      ? {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
          // The rider must know whether to collect money, and how much, to the paisa.
          paymentMethod: order.payment?.method ?? null,
          collectAmount:
            order.payment?.method === 'COD' && order.payment?.status !== 'PAID'
              ? toMoney(order.grandTotal)
              : null
        }
      : null
  };
}

/**
 * POST /api/rider/shift — on/off.
 *
 * Going off shift while carrying an order is refused: the alternative is a parcel
 * that belongs to nobody, and reassignment mid-flight is a Phase 3 problem.
 */
export const toggleShift = async (req, res) => {
  try {
    const on = req.body?.isOnShift;
    if (typeof on !== 'boolean') {
      return res.status(400).json({ message: 'isOnShift must be true or false.' });
    }

    const riderId = req.user.id;

    if (!on) {
      const live = await prisma.deliveryJob.count({
        where: { riderId, status: { in: LIVE_JOB_STATUSES } }
      });
      if (live > 0) {
        return res.status(409).json({
          message: 'Finish or hand back your current delivery before going off shift.'
        });
      }
    }

    const now = new Date();
    const shift = await prisma.$transaction(async (tx) => {
      const open = await tx.riderShift.findFirst({
        where: { riderId, endedAt: null },
        orderBy: { startedAt: 'desc' }
      });

      await tx.user.update({ where: { id: riderId }, data: { isOnShift: on } });

      if (on) {
        // Idempotent: tapping "on" twice must not open a second shift and inflate
        // hours-worked reporting.
        return open ?? tx.riderShift.create({
          data: { riderId, startedAt: now, zoneNote: str(req.body?.zoneNote, 120) }
        });
      }

      if (!open) return null;
      return tx.riderShift.update({ where: { id: open.id }, data: { endedAt: now } });
    });

    // A rider who just came on shift may be the one an order has been waiting for.
    let picked = 0;
    if (on) picked = await sweepUnassignedJobs();

    return res.status(200).json({
      status: 'success',
      isOnShift: on,
      shiftId: shift?.id ?? null,
      ...(on ? { jobsAssigned: picked } : {})
    });
  } catch (error) {
    console.error('Toggle Shift Error:', error);
    return res.status(500).json({ message: 'Server error while updating your shift.' });
  }
};

/**
 * Hand out jobs that had nobody to take them.
 *
 * An order can reach READY with no rider on shift; the job sits UNASSIGNED. This
 * runs when a rider comes on shift, which is the moment the situation changes.
 */
async function sweepUnassignedJobs(limit = 20) {
  const waiting = await prisma.deliveryJob.findMany({
    where: { type: 'LAST_MILE', status: 'UNASSIGNED', riderId: null, consumerOrderId: { not: null } },
    select: { consumerOrderId: true },
    orderBy: { createdAt: 'asc' },
    take: limit
  });

  let assigned = 0;
  for (const job of waiting) {
    const result = await assignRiderIfPossible(job.consumerOrderId);
    if (result.assigned) assigned += 1;
  }
  return assigned;
}

/**
 * POST /api/rider/location — `lastLat` / `lastLng` / `lastLocationAt`.
 *
 * Overwritten, never appended to: a pings-history table at one ping per ten
 * seconds per rider is millions of rows a week for no launch-day value
 * (HANDOFF §3).
 */
export const updateLocation = async (req, res) => {
  try {
    const lat = Number(req.body?.latitude ?? req.body?.lat);
    const lng = Number(req.body?.longitude ?? req.body?.lng);
    if (!isValidLatLng(lat, lng)) {
      return res.status(400).json({ message: 'A valid latitude and longitude are required.' });
    }

    const now = new Date();
    await prisma.user.update({
      where: { id: req.user.id },
      data: { lastLat: lat, lastLng: lng, lastLocationAt: now }
    });

    return res.status(200).json({ status: 'success', latitude: lat, longitude: lng, at: now });
  } catch (error) {
    console.error('Update Rider Location Error:', error);
    return res.status(500).json({ message: 'Server error while updating your location.' });
  }
};

/** GET /api/rider/jobs — live jobs first, then today's finished ones. */
export const listJobs = async (req, res) => {
  try {
    const jobs = await prisma.deliveryJob.findMany({
      where: { riderId: req.user.id },
      include: jobInclude,
      orderBy: [{ completedAt: 'asc' }, { assignedAt: 'desc' }],
      take: 50
    });

    return res.status(200).json({ status: 'success', jobs: jobs.map(jobView) });
  } catch (error) {
    console.error('List Rider Jobs Error:', error);
    return res.status(500).json({ message: 'Server error while loading your jobs.' });
  }
};

/** The rider's own job in a state they are allowed to move it out of. */
async function findJob(riderId, jobId, fromStatuses) {
  const job = await prisma.deliveryJob.findFirst({
    where: { id: jobId, riderId },
    include: jobInclude
  });
  if (!job) return { error: 404, message: 'Job not found.' };
  if (!fromStatuses.includes(job.status)) {
    return { error: 409, message: `A job that is ${job.status} cannot do that.`, job };
  }
  return { job };
}

/** POST /api/rider/jobs/:jobId/pickup — the goods are in the rider's hands. */
export const pickUp = async (req, res) => {
  try {
    const jobId = parseId(req.params.jobId);
    if (!jobId) return res.status(400).json({ message: 'Invalid job id.' });

    const found = await findJob(req.user.id, jobId, ['ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP']);
    if (found.error) return res.status(found.error).json({ message: found.message });

    const order = found.job.consumerOrder;
    // The shop has to have finished packing. A rider cannot collect a bag that
    // does not exist yet.
    if (order?.status !== 'READY') {
      return res.status(409).json({
        message: 'This order is not ready for pickup yet.',
        orderStatus: order?.status ?? null
      });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.deliveryJob.update({ where: { id: jobId }, data: { status: 'EN_ROUTE_DROP' } });
      await tx.consumerOrder.updateMany({
        where: { id: order.id, status: 'READY' },
        data: { status: 'PICKED' }
      });
    });

    const fresh = await prisma.deliveryJob.findUnique({ where: { id: jobId }, include: jobInclude });
    return res.status(200).json({ status: 'success', job: jobView(fresh) });
  } catch (error) {
    console.error('Pickup Error:', error);
    return res.status(500).json({ message: 'Server error while recording the pickup.' });
  }
};

/**
 * POST /api/rider/jobs/:jobId/deliver — the end of the pipeline.
 *
 * One transaction does everything that must be true together: the job is
 * closed, the order is DELIVERED, the shop's shelf finally drops, the
 * platform/shop commission split is frozen, and a COD order's cash is
 * recorded against the rider who is now holding it.
 *
 * The settlement accrual itself is a separate weekly run
 * (`src/jobs/runSettlement.js`) — it reads the split written here, it does not
 * recompute it, so a later change to `commission_percent` cannot reach back
 * into an already-delivered order.
 */
export const deliver = async (req, res) => {
  try {
    const jobId = parseId(req.params.jobId);
    if (!jobId) return res.status(400).json({ message: 'Invalid job id.' });

    const found = await findJob(req.user.id, jobId, ['EN_ROUTE_DROP', 'AT_PICKUP', 'ASSIGNED']);
    if (found.error) return res.status(found.error).json({ message: found.message });

    const { job } = found;
    const order = job.consumerOrder;
    if (order?.status !== 'PICKED') {
      return res.status(409).json({
        message: 'Collect the order from the shop before delivering it.',
        orderStatus: order?.status ?? null
      });
    }

    const code = str(req.body?.otpCode, 10);
    if (!code || !job.otpCode || code !== job.otpCode) {
      return res.status(422).json({ message: 'That delivery OTP is not correct.' });
    }

    // Checked before the transaction opens: a rejected URL must not have already
    // dropped the shop's stock and frozen two payouts.
    const photoUrl = podUrl(req.body?.photoUrl, 'POD_PHOTO');
    const signatureUrl = podUrl(req.body?.signatureUrl, 'POD_SIGNATURE');
    if (photoUrl === false || signatureUrl === false) {
      return res.status(400).json({
        message: 'That proof of delivery was not uploaded through RoadMate.',
        reason: 'NOT_OUR_ASSET'
      });
    }

    // The rider's fee, priced before the transaction opens (three config reads)
    // and frozen onto the job inside it — the same discipline as the commission
    // split, for the same reason: a later rate change must not reprice a trip
    // that has already been made.
    // ...and zero for a shop's own delivery boy, who is paid by his shop and
    // not by RoadMate. See `riderPay.js`.
    const earning = await computeRiderEarning(job, order.industryId, req.user);

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.deliveryJob.update({
        where: { id: jobId },
        data: {
          status: 'DELIVERED',
          riderEarning: earning.total,
          otpVerifiedAt: now,
          completedAt: now,
          photoUrl,
          signatureUrl,
          deliveryNote: str(req.body?.note)
        }
      });

      await tx.consumerOrder.update({
        where: { id: order.id },
        data: { status: 'DELIVERED', deliveredAt: now }
      });

      // The only place stock actually leaves the building.
      await decrementShelfOnDelivery(tx, order, now);

      // §1.8: freeze the platform/shop split now, against `commission_percent`
      // in `PlatformConfig` — never a hardcoded number on a shop-facing screen.
      await applyCommissionSplit(tx, order);

      if (order.payment?.method === 'COD' && order.payment.status !== 'PAID') {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: {
            status: 'PAID',
            collectedByRiderId: req.user.id,
            cashCollectedAt: now
            // cashRemittedAt stays null: the rider is holding the platform's
            // money until they hand it in. §1.8 closes that loop.
          }
        });
      }
    });

    const fresh = await prisma.deliveryJob.findUnique({ where: { id: jobId }, include: jobInclude });
    return res.status(200).json({ status: 'success', job: jobView(fresh) });
  } catch (error) {
    console.error('Deliver Error:', error);
    return res.status(500).json({ message: 'Server error while recording the delivery.' });
  }
};

/** POST /api/rider/jobs/:jobId/dead-run — a wasted trip. The platform pays. */
export const reportDeadRun = async (req, res) => {
  try {
    const jobId = parseId(req.params.jobId);
    if (!jobId) return res.status(400).json({ message: 'Invalid job id.' });

    const found = await findJob(req.user.id, jobId, [
      'ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_DROP'
    ]);
    if (found.error) return res.status(found.error).json({ message: found.message });

    const reason = str(req.body?.reason, 200) ?? 'Dead run — nothing to collect or nobody to deliver to.';

    await prisma.$transaction((tx) =>
      recordDeadRun(tx, { job: found.job, order: found.job.consumerOrder, reason, rider: req.user })
    );

    const fresh = await prisma.deliveryJob.findUnique({ where: { id: jobId }, include: jobInclude });
    return res.status(200).json({ status: 'success', job: jobView(fresh) });
  } catch (error) {
    console.error('Dead Run Error:', error);
    return res.status(500).json({ message: 'Server error while recording the dead run.' });
  }
};

/**
 * GET /api/rider/earnings — what Phase 3's earnings screen renders.
 *
 * Three things, because they are three different questions a rider asks:
 * what have I earned *today*, what is still unsettled, and what has the
 * platform already paid me. Everything comes from frozen `riderEarning`
 * columns and `RiderSettlement` rows — nothing is recomputed here, so the
 * screen can never disagree with the ledger.
 *
 * `rates` is included on purpose, unlike `commission_percent`: a rider is
 * entitled to know how their own pay is calculated, and it is *their* rate
 * rather than a cut the platform takes.
 *
 * ⚠️ A shop's own delivery boy has no platform earnings at all — his shop pays
 * him (HANDOFF §3). Showing him a screen of zeroes would read as "RoadMate owes
 * you nothing this week" rather than "RoadMate is not who pays you", so the
 * endpoint refuses and the app hides the tab. `employerShopId` on
 * `GET /api/auth/me` is what tells it to.
 */
export const getEarnings = async (req, res) => {
  try {
    if (req.user.employerShopId != null) {
      return res.status(403).json({
        message: 'You are paid by your shop, not by RoadMate. Ask them about your earnings.',
        reason: 'EMPLOYED_BY_SHOP'
      });
    }

    const riderId = req.user.id;
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const [settled, unsettled, today, rates] = await Promise.all([
      prisma.riderSettlement.findMany({
        where: { riderId },
        orderBy: { periodStart: 'desc' },
        take: 12
      }),
      prisma.deliveryJob.findMany({
        where: {
          riderId,
          completedAt: { not: null },
          OR: [{ status: 'DELIVERED' }, { isDeadRun: true }],
          riderSettlementLines: { none: {} }
        },
        select: { id: true, riderEarning: true, isDeadRun: true, completedAt: true, distanceKm: true }
      }),
      prisma.deliveryJob.findMany({
        where: {
          riderId,
          completedAt: { gte: since },
          OR: [{ status: 'DELIVERED' }, { isDeadRun: true }]
        },
        select: { riderEarning: true, isDeadRun: true }
      }),
      Promise.all([
        getConfigNumber(CONFIG_KEYS.RIDER_BASE_FEE),
        getConfigNumber(CONFIG_KEYS.RIDER_FREE_KM),
        getConfigNumber(CONFIG_KEYS.RIDER_PER_KM_FEE)
      ])
    ]);

    const sumEarnings = (rows) =>
      rows.reduce((sum, r) => sum.plus(r.riderEarning ?? 0), new Prisma.Decimal(0));

    return res.status(200).json({
      status: 'success',
      today: {
        deliveries: today.filter((j) => !j.isDeadRun).length,
        deadRuns: today.filter((j) => j.isDeadRun).length,
        earned: toMoney(sumEarnings(today))
      },
      pending: {
        jobCount: unsettled.length,
        total: toMoney(sumEarnings(unsettled)),
        jobs: unsettled.map((j) => ({
          jobId: j.id,
          completedAt: j.completedAt,
          distanceKm: j.distanceKm,
          isDeadRun: j.isDeadRun,
          earning: toMoney(j.riderEarning ?? 0)
        }))
      },
      settlements: settled.map((s) => ({
        id: s.id,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        deliveries: s.deliveries,
        deadRuns: s.deadRuns,
        netPayable: toMoney(s.netPayable),
        status: s.status,
        paidAt: s.paidAt,
        utrNumber: s.utrNumber
      })),
      // How the number above is arrived at. See the docblock.
      rates: { baseFee: toMoney(rates[0]), freeKm: rates[1], perKmFee: toMoney(rates[2]) }
    });
  } catch (error) {
    console.error('Rider Earnings Error:', error);
    return res.status(500).json({ message: 'Server error while loading your earnings.' });
  }
};

// --- COD cash-in-hand (§1.8) --------------------------------------------------
//
// `deliver()` above writes `collectedByRiderId` + `cashCollectedAt` and leaves
// `cashRemittedAt` null the moment cash changes hands — "who is holding what"
// was already a one-line query. These two endpoints are that query, and the
// write that closes it.

const heldByRider = (riderId) =>
  prisma.payment.findMany({
    where: { collectedByRiderId: riderId, cashRemittedAt: null },
    select: { id: true, amount: true, cashCollectedAt: true, consumerOrderId: true },
    orderBy: { cashCollectedAt: 'asc' }
  });

const sumAmounts = (rows) => rows.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));

/** GET /api/rider/remittance — cash I'm holding right now. */
export const getRemittanceSummary = async (req, res) => {
  try {
    const held = await heldByRider(req.user.id);

    return res.status(200).json({
      status: 'success',
      count: held.length,
      totalHeld: toMoney(sumAmounts(held)),
      payments: held.map((p) => ({
        consumerOrderId: p.consumerOrderId,
        amount: toMoney(p.amount),
        collectedAt: p.cashCollectedAt
      }))
    });
  } catch (error) {
    console.error('Rider Remittance Summary Error:', error);
    return res.status(500).json({ message: 'Server error while loading your cash summary.' });
  }
};

/**
 * POST /api/rider/remittance — hand it all in at once.
 *
 * A conditional `updateMany` re-asserting `cashRemittedAt: null`, the same
 * discipline as every other claim in this codebase: a rider who double-taps,
 * or remits while a delivery lands mid-request, cannot mark cash remitted
 * twice or lose a payment that arrived in between.
 */
export const remitCash = async (req, res) => {
  try {
    const held = await heldByRider(req.user.id);
    if (!held.length) {
      return res.status(200).json({ status: 'success', count: 0, totalRemitted: '0.00' });
    }

    const now = new Date();
    const claimed = await prisma.payment.updateMany({
      where: { id: { in: held.map((p) => p.id) }, cashRemittedAt: null },
      data: { cashRemittedAt: now }
    });

    return res.status(200).json({
      status: 'success',
      count: claimed.count,
      totalRemitted: toMoney(sumAmounts(held))
    });
  } catch (error) {
    console.error('Remit Cash Error:', error);
    return res.status(500).json({ message: 'Server error while remitting cash.' });
  }
};
