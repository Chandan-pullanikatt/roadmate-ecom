// Phase 1.8 — the commission split written at delivery, and the weekly
// settlement run that pays it out.
//
// `commission_percent` lives in `PlatformConfig` (default 15, an undocumented
// number inherited from the old `orderController.js:196` — PLAN §7.1). This
// file is the *only* place that number turns into money on a `ConsumerOrder`,
// so it never leaks onto a shop-facing screen as if it were confirmed policy.
import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { getConfigNumber, CONFIG_KEYS } from './platformConfig.js';

/** `grandTotal` split by a commission percent, both rounded to the paisa. */
export function commissionSplit(grandTotal, commissionPercent) {
  const total = new Prisma.Decimal(grandTotal);
  const platformCommission = total
    .times(commissionPercent)
    .dividedBy(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const shopPayable = total.minus(platformCommission);
  return { platformCommission, shopPayable };
}

/**
 * Written onto the order inside `riderController.deliver()`'s transaction —
 * delivery is the moment the sale is final, so it is the moment the split is
 * computed and frozen. A later change to `commission_percent` must never
 * reach back and rewrite an already-delivered order.
 */
export async function applyCommissionSplit(tx, order) {
  const commissionPercent = await getConfigNumber(CONFIG_KEYS.COMMISSION_PERCENT, order.industryId);
  const { platformCommission, shopPayable } = commissionSplit(order.grandTotal, commissionPercent);

  return tx.consumerOrder.update({
    where: { id: order.id },
    data: { platformCommission, shopPayable }
  });
}

/**
 * The weekly payout run — `src/jobs/runSettlement.js` calls this, on a
 * schedule, not a route (PLAN §6).
 *
 * One `Settlement` per shop per period. Eligible orders are DELIVERED, land
 * inside `[periodStart, periodEnd)` by `deliveredAt`, and are not already on
 * *any* `SettlementLine` — that second check is what makes re-running a
 * partially-failed week safe: an order a previous, interrupted run already
 * settled is simply skipped rather than paid out twice. The schema's
 * `@@unique([shopId, periodStart])` backs this up for the shop-level row.
 */
export async function runSettlement({ periodStart, periodEnd }) {
  const orders = await prisma.consumerOrder.findMany({
    where: {
      status: 'DELIVERED',
      deliveredAt: { gte: periodStart, lt: periodEnd },
      shopId: { not: null },
      settlementLines: { none: {} }
    },
    include: { payment: true }
  });

  const byShop = new Map();
  for (const order of orders) {
    const list = byShop.get(order.shopId) ?? [];
    list.push(order);
    byShop.set(order.shopId, list);
  }

  const settlements = [];
  for (const [shopId, shopOrders] of byShop) {
    const settlement = await prisma.$transaction(async (tx) => {
      // Idempotent re-run guard at the shop level, on top of the per-order
      // `settlementLines: none` filter above.
      const existing = await tx.settlement.findUnique({
        where: { shopId_periodStart: { shopId, periodStart } }
      });
      if (existing) return existing;

      let grossSales = new Prisma.Decimal(0);
      let commission = new Prisma.Decimal(0);
      let codCollected = new Prisma.Decimal(0);
      let netPayable = new Prisma.Decimal(0);

      for (const order of shopOrders) {
        grossSales = grossSales.plus(order.grandTotal);
        commission = commission.plus(order.platformCommission);
        netPayable = netPayable.plus(order.shopPayable);
        if (order.payment?.method === 'COD' && order.payment.status === 'PAID') {
          codCollected = codCollected.plus(order.payment.amount);
        }
      }

      const created = await tx.settlement.create({
        data: {
          shopId,
          periodStart,
          periodEnd,
          grossSales,
          commission,
          codCollected,
          deductions: new Prisma.Decimal(0), // shop deductions stay 0 in year one (HANDOFF §3)
          netPayable,
          status: 'OPEN'
        }
      });

      await tx.settlementLine.createMany({
        data: shopOrders.map((order) => ({
          settlementId: created.id,
          consumerOrderId: order.id,
          gross: order.grandTotal,
          commission: order.platformCommission,
          net: order.shopPayable
        }))
      });

      return created;
    });

    settlements.push(settlement);
  }

  return { periodStart, periodEnd, shopCount: settlements.length, settlements };
}

/**
 * The rider half of the same weekly run.
 *
 * Riders are independent partners (HANDOFF §3, revised 2026-08-07), so they are
 * paid rather than employed, and the payout needs the same ledger a shop's does.
 * Eligible jobs completed inside `[periodStart, periodEnd)` and are not already
 * on *any* `RiderSettlementLine` — that, plus the `@@unique([riderId,
 * periodStart])` guard below, is what makes an interrupted week safe to re-run.
 *
 * Both DELIVERED and dead-run FAILED jobs are paid: a dead run is a trip the
 * rider actually made, and HANDOFF §3 is explicit that the platform absorbs it.
 * They are summed separately so the figure can be explained rather than just
 * transferred.
 */
export async function runRiderSettlement({ periodStart, periodEnd }) {
  const jobs = await prisma.deliveryJob.findMany({
    where: {
      riderId: { not: null },
      // A shop's own delivery boy gets no row in the platform's weekly rider
      // run (HANDOFF §3): RoadMate does not pay him, so there is nothing to
      // settle. His jobs already carry `riderEarning` 0 from `riderPay.js`;
      // this filter is what stops the run minting a ₹0 settlement he would be
      // notified about. It is the pay decision, not the blocked §7.8 ones —
      // nothing about COD cash or the delivery fee is touched here.
      rider: { employerShopId: null },
      completedAt: { gte: periodStart, lt: periodEnd },
      OR: [{ status: 'DELIVERED' }, { isDeadRun: true }],
      riderSettlementLines: { none: {} }
    }
  });

  const byRider = new Map();
  for (const job of jobs) {
    const list = byRider.get(job.riderId) ?? [];
    list.push(job);
    byRider.set(job.riderId, list);
  }

  const settlements = [];
  for (const [riderId, riderJobs] of byRider) {
    const settlement = await prisma.$transaction(async (tx) => {
      const existing = await tx.riderSettlement.findUnique({
        where: { riderId_periodStart: { riderId, periodStart } }
      });
      if (existing) return existing;

      let grossEarning = new Prisma.Decimal(0);
      let deadRunFees = new Prisma.Decimal(0);
      let deliveries = 0;
      let deadRuns = 0;

      for (const job of riderJobs) {
        const earning = new Prisma.Decimal(job.riderEarning ?? 0);
        if (job.isDeadRun) {
          deadRunFees = deadRunFees.plus(earning);
          deadRuns += 1;
        } else {
          grossEarning = grossEarning.plus(earning);
          deliveries += 1;
        }
      }

      const created = await tx.riderSettlement.create({
        data: {
          riderId,
          periodStart,
          periodEnd,
          deliveries,
          deadRuns,
          grossEarning,
          deadRunFees,
          deductions: new Prisma.Decimal(0), // nothing deducts from a rider in year one
          netPayable: grossEarning.plus(deadRunFees),
          status: 'OPEN'
        }
      });

      await tx.riderSettlementLine.createMany({
        data: riderJobs.map((job) => ({
          riderSettlementId: created.id,
          deliveryJobId: job.id,
          earning: new Prisma.Decimal(job.riderEarning ?? 0),
          isDeadRun: job.isDeadRun
        }))
      });

      return created;
    });

    settlements.push(settlement);
  }

  return { periodStart, periodEnd, riderCount: settlements.length, settlements };
}
