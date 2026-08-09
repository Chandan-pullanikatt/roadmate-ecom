import prisma from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { normalizePhone } from '../lib/phone.js';
import { ensureSubscription } from '../lib/subscription.js';


// Create a downstream partner profile
export const createPartner = async (req, res) => {
  try {
    const {
      role, email, name, phone, password,
      stateName, districtName, regionName, industryId,
      businessName, gstNumber, aadhaarNumber, panNumber,
      monthlyCost, bankName, accountHolder, accountNumber,
      ifscCode, accountType, upiId, sharePercentage
    } = req.body;

    const parentId = req.user.id;

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
        sharePercentage: sharePercentage ? parseFloat(sharePercentage) : 0.0
      }
    });

    res.status(201).json({
      status: 'success',
      partner: {
        id: newPartner.id,
        email: newPartner.email,
        name: newPartner.name,
        role: newPartner.role,
        isActive: newPartner.isActive
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

// Get downstream list (approved partners)
export const getActivePartners = async (req, res) => {
  try {
    const { role, stateName, districtName, regionName, industryId } = req.user;
    let whereClause = { isActive: true };

    if (role === 'MASTER') {
      whereClause = { isActive: true, role: { not: 'MASTER' } };
    } else if (role === 'STATE') {
      whereClause = { isActive: true, stateName, role: { not: 'STATE' } };
    } else if (role === 'IND_STATE') {
      whereClause = { isActive: true, stateName, industryId, role: { not: 'IND_STATE' } };
    } else if (role === 'DISTRICT') {
      whereClause = { isActive: true, districtName, industryId, role: { not: 'DISTRICT' } };
    } else if (role === 'REGIONAL') {
      whereClause = { isActive: true, regionName, industryId, role: { in: ['SHOP', 'EXECUTIVE', 'DISTRIBUTOR'] } };
    } else if (role === 'DISTRIBUTOR') {
      whereClause = { isActive: true, districtName, industryId, role: 'SHOP' };
    } else {
      whereClause = { id: 0 }; // Fail safe empty
    }

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
