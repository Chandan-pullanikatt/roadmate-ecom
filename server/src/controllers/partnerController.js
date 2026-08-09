import prisma from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { normalizePhone } from '../lib/phone.js';
import { ensureSubscription } from '../lib/subscription.js';
import { isValidLatLng, parseServiceRadiusKm, MAX_SERVICE_RADIUS_KM } from '../lib/geo.js';


// Create a downstream partner profile
export const createPartner = async (req, res) => {
  try {
    const {
      role, email, name, phone, password,
      stateName, districtName, regionName, industryId,
      businessName, gstNumber, aadhaarNumber, panNumber,
      monthlyCost, bankName, accountHolder, accountNumber,
      ifscCode, accountType, upiId, sharePercentage,
      latitude, longitude, serviceRadiusKm
    } = req.body;

    const parentId = req.user.id;

    // ── Where the shop is ────────────────────────────────────────────────────
    //
    // A SHOP's coordinates are the one field on this form that decides whether
    // the business can trade at all. `rankCandidateShops` prefilters on
    // `@@index([role, latitude, longitude])` and refines by haversine, so a shop
    // with NULL coordinates is not "unranked" — it is invisible to every
    // customer, forever, with nothing anywhere reporting that it is missing.
    //
    // Hence: required for SHOP, and a hard 400 rather than a default. There is
    // no sensible fallback — the district centroid would route real orders to a
    // real rider at the wrong address. Every other role is onboarded without
    // coordinates because nothing geographic is ever asked of them; they may
    // still supply a pin, and it is stored.
    const wantsLocation =
      latitude !== undefined || longitude !== undefined || role === 'SHOP';
    let location = null;

    if (wantsLocation) {
      const lat = typeof latitude === 'number' ? latitude : Number.parseFloat(latitude);
      const lng = typeof longitude === 'number' ? longitude : Number.parseFloat(longitude);
      if (!isValidLatLng(lat, lng)) {
        return res.status(400).json({
          message:
            role === 'SHOP'
              ? 'Pick the shop on the map. Without its location no customer can find it.'
              : 'latitude and longitude must be a valid coordinate pair.',
          reason: 'LOCATION_REQUIRED'
        });
      }
      location = { latitude: lat, longitude: lng };
    }

    // The radius is optional even for a shop: `service_radius_km` in
    // PlatformConfig is the documented fallback, and unlike the coordinates a
    // missing one has a correct answer. A supplied one is still validated.
    if (serviceRadiusKm !== undefined && serviceRadiusKm !== null && serviceRadiusKm !== '') {
      const parsed = parseServiceRadiusKm(serviceRadiusKm);
      if (!parsed.ok) {
        return res.status(400).json({
          message: `serviceRadiusKm must be between 0 and ${MAX_SERVICE_RADIUS_KM} km.`,
          reason: 'BAD_SERVICE_RADIUS'
        });
      }
      location = { ...(location || {}), serviceRadiusKm: parsed.value };
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // The phone number is a sign-in identifier now, so it is normalised on the
    // way in and unique in the database. Rejecting a malformed number here is
    // kinder than letting it through: an unnormalised number is one this person
    // will never be able to sign in with.
    let normalizedPhone = null;
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      normalizedPhone = normalizePhone(String(phone));
      if (!normalizedPhone) {
        return res.status(400).json({
          message: 'Enter a valid 10-digit Indian mobile number (it is also their sign-in ID).'
        });
      }
      const phoneTaken = await prisma.user.findFirst({ where: { phone: normalizedPhone } });
      if (phoneTaken) {
        return res.status(400).json({ message: 'Another account already uses this phone number' });
      }
    }

    // Encrypt temporary or user-specified password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password || 'password123', salt);

    // Create the downstream profile (defaults to isActive: false, except if Master creates)
    const isActive = req.user.role === 'MASTER' ? true : false;

    const newPartner = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        name,
        phone: normalizedPhone,
        role,
        isActive,
        // A Master-created partner is active on creation, so that is also the
        // moment its trial clock would start.
        approvedAt: isActive ? new Date() : null,
        country: 'India',
        stateName: stateName || req.user.stateName,
        districtName: districtName || req.user.districtName,
        regionName: regionName || req.user.regionName,
        industryId: industryId ? parseInt(industryId) : req.user.industryId,
        parentId,
        businessName,
        gstNumber,
        aadhaarNumber,
        panNumber,
        monthlyCost: monthlyCost ? parseFloat(monthlyCost) : 0.0,
        bankName,
        accountHolder,
        accountNumber,
        ifscCode,
        accountType,
        upiId,
        sharePercentage: sharePercentage ? parseFloat(sharePercentage) : 0.0,
        ...(location || {})
      }
    });

    res.status(201).json({
      status: 'success',
      partner: {
        id: newPartner.id,
        email: newPartner.email,
        name: newPartner.name,
        role: newPartner.role,
        isActive: newPartner.isActive,
        latitude: newPartner.latitude,
        longitude: newPartner.longitude,
        serviceRadiusKm: newPartner.serviceRadiusKm
      }
    });
  } catch (error) {
    console.error('Create Partner Error:', error);
    res.status(500).json({ message: 'Server error onboarding partner profile.' });
  }
};

// Retrieve pending approvals
export const getPendingApprovals = async (req, res) => {
  try {
    const { role, id: userId, stateName, districtName, industryId } = req.user;
    let whereClause = { isActive: false };

    if (role === 'MASTER') {
      // Master sees all pending approvals
      whereClause = { isActive: false };
    } else if (role === 'STATE') {
      whereClause = {
        isActive: false,
        stateName: stateName,
        role: { in: ['IND_STATE', 'DISTRICT', 'REGIONAL'] }
      };
    } else if (role === 'IND_STATE') {
      whereClause = {
        isActive: false,
        stateName: stateName,
        industryId: industryId,
        role: { in: ['DISTRICT', 'REGIONAL', 'MANUFACTURER'] }
      };
    } else if (role === 'DISTRICT') {
      whereClause = {
        isActive: false,
        districtName: districtName,
        industryId: industryId,
        role: { in: ['REGIONAL', 'DISTRIBUTOR', 'EXECUTIVE'] }
      };
    } else if (role === 'REGIONAL') {
      whereClause = {
        isActive: false,
        regionName: req.user.regionName,
        industryId: industryId,
        role: { in: ['SHOP', 'EXECUTIVE'] }
      };
    } else {
      return res.status(200).json({ status: 'success', approvals: [] });
    }

    const approvals = await prisma.user.findMany({
      where: whereClause,
      include: {
        industry: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      status: 'success',
      approvals
    });
  } catch (error) {
    console.error('Get Approvals Error:', error);
    res.status(500).json({ message: 'Server error retrieving pending approvals queue.' });
  }
};

// Approve profile
export const approvePartner = async (req, res) => {
  try {
    const { id } = req.params;

    // `approvedAt` is stamped once and never moved. The agreed 3-month free
    // trial counts from approval (a partner cannot trade before it), and
    // re-approving an already-active account — which this endpoint allows, it
    // is a plain idempotent `update` with no conditional WHERE — must not
    // restart somebody's trial. Hence the coalesce rather than a bare `new
    // Date()`.
    const current = await prisma.user.findUnique({
      where: { id: parseInt(id) },
      select: { approvedAt: true }
    });
    if (!current) {
      return res.status(404).json({ message: 'Partner not found.' });
    }

    const partner = await prisma.user.update({
      where: { id: parseInt(id) },
      data: { isActive: true, approvedAt: current.approvedAt ?? new Date() }
    });

    // The trial clock starts here (HANDOFF §7ter). `ensureSubscription` is a
    // no-op for a role that is never billed and for a partner who already has
    // one, so re-approving cannot restart a trial — the same reason
    // `approvedAt` is coalesced above.
    await ensureSubscription(partner);

    res.status(200).json({
      status: 'success',
      message: `Profile ${partner.name} approved and activated successfully.`,
      partner
    });
  } catch (error) {
    console.error('Approve Partner Error:', error);
    res.status(500).json({ message: 'Server error activating partner profile.' });
  }
};

// Reject partner
export const rejectPartner = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.user.delete({
      where: { id: parseInt(id) }
    });

    res.status(200).json({
      status: 'success',
      message: 'Partner onboarding request rejected and profile removed.'
    });
  } catch (error) {
    console.error('Reject Partner Error:', error);
    res.status(500).json({ message: 'Server error rejecting partner onboarding.' });
  }
};

/**
 * Which partners this staff user may see and act on.
 *
 * Extracted from `getActivePartners` so that `setPartnerLocation` cannot answer
 * the question differently: a second copy of this ladder is how a regional
 * partner ends up able to move a shop in somebody else's district. The fail-safe
 * clause is `{ id: 0 }` — a role not listed here reaches nobody, rather than
 * everybody.
 */
export function visiblePartnerWhere(user) {
  const { role, stateName, districtName, regionName, industryId } = user;

  if (role === 'MASTER') return { isActive: true, role: { not: 'MASTER' } };
  if (role === 'STATE') return { isActive: true, stateName, role: { not: 'STATE' } };
  if (role === 'IND_STATE') return { isActive: true, stateName, industryId, role: { not: 'IND_STATE' } };
  if (role === 'DISTRICT') return { isActive: true, districtName, industryId, role: { not: 'DISTRICT' } };
  if (role === 'REGIONAL') {
    return { isActive: true, regionName, industryId, role: { in: ['SHOP', 'EXECUTIVE', 'DISTRIBUTOR'] } };
  }
  if (role === 'DISTRIBUTOR') return { isActive: true, districtName, industryId, role: 'SHOP' };
  return { id: 0 }; // Fail safe empty
}

// Get downstream list (approved partners)
export const getActivePartners = async (req, res) => {
  try {
    const whereClause = visiblePartnerWhere(req.user);

    const partners = await prisma.user.findMany({
      where: whereClause,
      include: {
        industry: {
          select: { name: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.status(200).json({
      status: 'success',
      partners
    });
  } catch (error) {
    console.error('Get Active Partners Error:', error);
    res.status(500).json({ message: 'Server error fetching active partners.' });
  }
};

/**
 * PATCH /api/partners/:id/location — put an existing partner on the map.
 *
 * `createPartner` now refuses to onboard a shop without coordinates, but that
 * does nothing for the shops already in the database with NULL ones, and there
 * is no other way to reach them: a shop can correct its own pin from the Shop
 * app (`PATCH /api/shop/storefront`) and that assumes it can already sign in and
 * knows to look. This is the operator's side of the same field.
 *
 * Scoped by `visiblePartnerWhere`, so this is exactly the set of partners the
 * caller can already see on their network screen — no new reach, one new verb.
 */
export const setPartnerLocation = async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid partner id.' });
    }

    const { latitude, longitude, serviceRadiusKm } = req.body || {};
    const data = {};

    if (latitude !== undefined || longitude !== undefined) {
      const lat = Number.parseFloat(latitude);
      const lng = Number.parseFloat(longitude);
      if (!isValidLatLng(lat, lng)) {
        return res.status(400).json({
          message: 'Set latitude and longitude together, as a valid coordinate pair.',
          reason: 'BAD_LOCATION'
        });
      }
      data.latitude = lat;
      data.longitude = lng;
    }

    if (serviceRadiusKm !== undefined) {
      // Unlike the coordinates, blanking the radius is meaningful: it falls the
      // shop back to the `service_radius_km` config row, which is the same
      // "blank clears, and is not 0" rule the Master settings screen enforces.
      if (serviceRadiusKm === null || serviceRadiusKm === '') {
        data.serviceRadiusKm = null;
      } else {
        const parsed = parseServiceRadiusKm(serviceRadiusKm);
        if (!parsed.ok) {
          return res.status(400).json({
            message: `serviceRadiusKm must be between 0 and ${MAX_SERVICE_RADIUS_KM} km.`,
            reason: 'BAD_SERVICE_RADIUS'
          });
        }
        data.serviceRadiusKm = parsed.value;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    // The scope check and the write are one statement: `updateMany` with the
    // visibility clause ANDed onto the id. A `findFirst` then `update` would be
    // the same claim discipline the rest of this codebase avoids — and a count
    // of 0 here means "not yours, or not there", which are deliberately the same
    // answer, because distinguishing them tells a caller a partner exists.
    const moved = await prisma.user.updateMany({
      where: { AND: [{ id }, visiblePartnerWhere(req.user)] },
      data
    });
    if (moved.count === 0) {
      return res.status(404).json({ message: 'Partner not found.' });
    }

    const partner = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, latitude: true, longitude: true, serviceRadiusKm: true }
    });
    return res.status(200).json({ status: 'success', partner });
  } catch (error) {
    console.error('Set Partner Location Error:', error);
    return res.status(500).json({ message: 'Server error updating partner location.' });
  }
};

// Retrieve expenses
export const getExpenses = async (req, res) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      status: 'success',
      expenses
    });
  } catch (error) {
    console.error('Get Expenses Error:', error);
    res.status(500).json({ message: 'Server error retrieving expense ledger.' });
  }
};

// Log a new expense
export const createExpense = async (req, res) => {
  try {
    const { title, amount, category, notes } = req.body;

    if (!title || !amount || !category) {
      return res.status(400).json({ message: 'Please specify title, amount, and category' });
    }

    const newExpense = await prisma.expense.create({
      data: {
        title,
        amount: parseFloat(amount),
        category,
        notes,
        userId: req.user.id
      }
    });

    res.status(201).json({
      status: 'success',
      expense: newExpense
    });
  } catch (error) {
    console.error('Create Expense Error:', error);
    res.status(500).json({ message: 'Server error logging expense transaction.' });
  }
};
