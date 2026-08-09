// A shop's own delivery boys (HANDOFF §3, "two delivery modes", 2026-08-08).
//
// A shop either uses RoadMate's delivery partners or its own staff, and the
// shop is the switch. This file is the half of that feature the shop touches:
// hiring, releasing, and seeing who is on shift.
//
// Three things it exists to get right:
//
//   1. THE SHOP ADDS ITS OWN STAFF. A field executive onboards shops; it does
//      not know a shop's employees, and routing a hire through the platform
//      would mean a shop cannot replace a delivery boy who quit on a Sunday.
//
//   2. A HIRE IS A REAL RIDER ACCOUNT. He signs into RoadMate Rider, goes on
//      shift, and is tracked exactly like a platform partner — the delivery
//      flow is identical, the ownership is not. So this creates an ordinary
//      `EXECUTIVE` / `executiveType: 'DELIVERY'` user, with `employerShopId`
//      set. That single column is the whole difference.
//
//   3. RELEASING IS DEACTIVATION, NOT UNLINKING. Clearing `employerShopId`
//      would move a shop's ex-employee into the *platform* pool, where he would
//      start being offered rival shops' orders — the exact failure the pool
//      split exists to prevent. Only the platform can turn somebody into a
//      RoadMate delivery partner, so "remove" here means `isActive: false`.
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { normalizePhone } from '../lib/phone.js';
import { LIVE_JOB_STATUSES } from '../lib/delivery.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const str = (raw, max = 120) =>
  typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null;

/** What the shop's delivery-staff screen renders. No password, no bank data. */
const riderView = (rider, liveJobs = 0) => ({
  id: rider.id,
  name: rider.name,
  phone: rider.phone,
  isActive: rider.isActive,
  isOnShift: rider.isOnShift,
  vehicleType: rider.vehicleType,
  vehicleNumber: rider.vehicleNumber,
  lastLocationAt: rider.lastLocationAt,
  // "On shift" is not "available" — the screen has to be able to say which of
  // the two boys standing in the shop is actually out on a drop.
  liveJobs
});

const riderColumns = {
  id: true,
  name: true,
  phone: true,
  isActive: true,
  isOnShift: true,
  vehicleType: true,
  vehicleNumber: true,
  lastLocationAt: true
};

/**
 * GET /api/shop/riders — this shop's delivery staff, and who is out.
 *
 * Also reports `usesOwnRiders`, because the list is meaningless without it: a
 * shop can employ three boys and still be on the platform pool, in which case
 * none of them will ever be offered one of its orders.
 */
export const listShopRiders = async (req, res) => {
  try {
    const shopId = req.user.id;

    const riders = await prisma.user.findMany({
      where: { role: 'EXECUTIVE', executiveType: 'DELIVERY', employerShopId: shopId },
      select: riderColumns,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }]
    });

    const live = riders.length
      ? await prisma.deliveryJob.groupBy({
          by: ['riderId'],
          where: { riderId: { in: riders.map((r) => r.id) }, status: { in: LIVE_JOB_STATUSES } },
          _count: { _all: true }
        })
      : [];
    const liveByRider = new Map(live.map((row) => [row.riderId, row._count._all]));

    const shop = await prisma.user.findUnique({
      where: { id: shopId },
      select: { usesOwnRiders: true }
    });

    return res.status(200).json({
      status: 'success',
      usesOwnRiders: Boolean(shop?.usesOwnRiders),
      riders: riders.map((r) => riderView(r, liveByRider.get(r.id) ?? 0))
    });
  } catch (error) {
    console.error('List Shop Riders Error:', error);
    return res.status(500).json({ message: 'Server error while loading your delivery staff.' });
  }
};

/**
 * POST /api/shop/riders — hire one.
 *
 * The phone number is the sign-in identifier (HANDOFF §3), so it is normalised
 * and required here even though `User.phone` is nullable: an account a delivery
 * boy cannot sign into is not worth creating. The email column is `@unique` and
 * `NOT NULL`, so a placeholder is synthesised from the number — he will never
 * type it.
 */
export const createShopRider = async (req, res) => {
  try {
    const shopId = req.user.id;

    const name = str(req.body?.name, 80);
    if (!name) return res.status(400).json({ message: "The delivery partner's name is required." });

    const phone = normalizePhone(String(req.body?.phone ?? ''));
    if (!phone) {
      return res.status(400).json({
        message: 'Enter a valid 10-digit Indian mobile number — it is also their sign-in ID.'
      });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 6) {
      return res.status(400).json({ message: 'Set a password of at least 6 characters.' });
    }

    const taken = await prisma.user.findFirst({ where: { phone } });
    if (taken) {
      return res.status(409).json({
        message: 'Another RoadMate account already uses this phone number.',
        reason: 'PHONE_TAKEN'
      });
    }

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));

    const rider = await prisma.user.create({
      data: {
        // Never typed by anyone. `email` is unique and non-null in the schema;
        // the phone number is what this person actually signs in with.
        email: `rider-${phone}@shop${shopId}.roadmate.local`,
        password: passwordHash,
        name,
        phone,
        role: 'EXECUTIVE',
        executiveType: 'DELIVERY',
        // Hired by his employer, so he is usable immediately — there is nobody
        // upstream to approve a shop's own choice of staff.
        isActive: true,
        approvedAt: new Date(),
        employerShopId: shopId,
        parentId: shopId,
        bossId: shopId,
        industryId: req.user.industryId ?? null,
        country: 'India',
        stateName: req.user.stateName ?? null,
        districtName: req.user.districtName ?? null,
        regionName: req.user.regionName ?? null,
        vehicleType: str(req.body?.vehicleType, 40),
        vehicleNumber: str(req.body?.vehicleNumber, 20)
      },
      select: riderColumns
    });

    return res.status(201).json({ status: 'success', rider: riderView(rider) });
  } catch (error) {
    console.error('Create Shop Rider Error:', error);
    return res.status(500).json({ message: 'Server error while adding your delivery partner.' });
  }
};

/**
 * PATCH /api/shop/riders/:riderId — vehicle details, or take them off the roster.
 *
 * Deactivating is refused while they are carrying an order, for the same reason
 * a rider cannot go off shift mid-job (§1.7): the alternative is a parcel that
 * belongs to nobody. `employerShopId` is not settable — see the header.
 */
export const updateShopRider = async (req, res) => {
  try {
    const riderId = parseId(req.params.riderId);
    if (!riderId) return res.status(400).json({ message: 'Invalid rider id.' });

    const rider = await prisma.user.findFirst({
      where: {
        id: riderId,
        role: 'EXECUTIVE',
        executiveType: 'DELIVERY',
        employerShopId: req.user.id
      }
    });
    if (!rider) return res.status(404).json({ message: 'That person is not on your delivery staff.' });

    const data = {};

    for (const field of ['vehicleType', 'vehicleNumber']) {
      if (req.body?.[field] !== undefined) {
        data[field] = req.body[field] === null ? null : str(req.body[field], 40);
      }
    }

    if (req.body?.isActive !== undefined) {
      const next = Boolean(req.body.isActive);
      if (!next) {
        const live = await prisma.deliveryJob.count({
          where: { riderId, status: { in: LIVE_JOB_STATUSES } }
        });
        if (live > 0) {
          return res.status(409).json({
            message: 'They are out on a delivery. Wait until it is completed before removing them.',
            reason: 'RIDER_ON_JOB',
            liveJobs: live
          });
        }
      }
      data.isActive = next;
      // Off the roster is off shift. Leaving `isOnShift` true would keep them
      // counting towards this shop's serviceability while they are gone.
      if (!next) data.isOnShift = false;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    // The claim: a job can land on this rider between the count above and here.
    const moved = await prisma.user.updateMany({
      where: {
        id: riderId,
        employerShopId: req.user.id,
        ...(data.isActive === false
          ? { deliveryJobs: { none: { status: { in: LIVE_JOB_STATUSES } } } }
          : {})
      },
      data
    });
    if (moved.count === 0) {
      return res.status(409).json({
        message: 'A delivery landed on them while you were editing. Try again in a moment.',
        reason: 'RIDER_ON_JOB'
      });
    }

    const fresh = await prisma.user.findUnique({ where: { id: riderId }, select: riderColumns });
    return res.status(200).json({ status: 'success', rider: riderView(fresh) });
  } catch (error) {
    console.error('Update Shop Rider Error:', error);
    return res.status(500).json({ message: 'Server error while updating your delivery partner.' });
  }
};
