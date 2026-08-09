// Phase 1.8 — the reconciliation view: which riders are holding the
// platform's COD cash right now, across everyone, not just their own summary
// (`GET /api/rider/remittance` in `riderController.js` is the rider's own view
// of the same data).
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { toMoney } from '../lib/cart.js';

/** GET /api/finance/cod-outstanding — staff-only, MASTER. */
export const getCodOutstanding = async (req, res) => {
  try {
    const held = await prisma.payment.findMany({
      where: {
        method: 'COD',
        status: 'PAID',
        collectedByRiderId: { not: null },
        cashRemittedAt: null
      },
      select: { collectedByRiderId: true, amount: true, cashCollectedAt: true },
      orderBy: { cashCollectedAt: 'asc' }
    });

    const byRider = new Map();
    for (const p of held) {
      const entry = byRider.get(p.collectedByRiderId) ?? {
        total: new Prisma.Decimal(0),
        count: 0,
        oldest: p.cashCollectedAt
      };
      entry.total = entry.total.plus(p.amount);
      entry.count += 1;
      byRider.set(p.collectedByRiderId, entry);
    }

    const riders = await prisma.user.findMany({
      where: { id: { in: [...byRider.keys()] } },
      select: { id: true, name: true, phone: true }
    });
    const riderById = new Map(riders.map((r) => [r.id, r]));

    let grandTotal = new Prisma.Decimal(0);
    const rows = [...byRider.entries()].map(([riderId, entry]) => {
      grandTotal = grandTotal.plus(entry.total);
      return {
        riderId,
        name: riderById.get(riderId)?.name ?? null,
        phone: riderById.get(riderId)?.phone ?? null,
        count: entry.count,
        totalHeld: toMoney(entry.total),
        oldestCollectedAt: entry.oldest
      };
    });

    return res.status(200).json({
      status: 'success',
      riders: rows.sort((a, b) => Number(b.totalHeld) - Number(a.totalHeld)),
      grandTotal: toMoney(grandTotal)
    });
  } catch (error) {
    console.error('COD Outstanding Error:', error);
    return res.status(500).json({ message: 'Server error while loading COD outstanding.' });
  }
};
