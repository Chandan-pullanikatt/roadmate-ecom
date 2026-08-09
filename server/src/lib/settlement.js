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
 *
 * ── Who funds the rider (client call, 2026-08-09) ───────────────────────────
 *
 * `shopPayable` is the order less the platform's commission **and less whatever
 * the rider costs that the shop is responsible for**:
 *
 *   · Below `free_delivery_threshold`, the customer was charged `deliveryFee`
 *     and that money funds the rider. It sits inside `grandTotal`, so it is
 *     subtracted here — otherwise the platform hands the shop the very fee it
 *     collected to pay the rider with, which is what it did until now and what
 *     `commission_percent` at 15 was quietly masking.
 *
 *   · At or above the threshold the customer paid no fee (`deliveryFee` is 0)
 *     and the SHOP pays the rider instead. "Free delivery" is free to the
 *     customer, not to anybody else. `riderEarning` is the actual frozen figure
 *     from the job — ₹25 + ₹8/km, not a flat guess — so a shop serving a distant
 *     customer bears what that really cost.
 *
 * @param riderEarning what the platform is paying the rider for this job, as a
 *   Decimal. Passed in rather than re-read, because `deliver()` has already
 *   frozen it onto the `DeliveryJob` in this same transaction and two reads of
 *   a config row can disagree.
 */
export async function applyCommissionSplit(tx, order, riderEarning = 0) {
  const commissionPercent = await getConfigNumber(CONFIG_KEYS.COMMISSION_PERCENT, order.industryId);
  const { platformCommission } = commissionSplit(order.grandTotal, commissionPercent);

  const deliveryFunding = order.shopFundsDelivery
    ? new Prisma.Decimal(riderEarning ?? 0)
    : new Prisma.Decimal(order.deliveryFee ?? 0);

  const shopPayable = new Prisma.Decimal(order.grandTotal)
    .minus(platformCommission)
    .minus(deliveryFunding)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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
    // `collectedByRider` is what tells a shop-collected COD order from a
    // platform-collected one — see `selfCollectedCash` below.
    include: { payment: { include: { collectedByRider: { select: { employerShopId: true } } } } }
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
      // Cash this shop's OWN delivery boy took at the door. It never reached the
      // platform — it went from the customer's hand to the shop's employee to
      // the shop. See the deduction below.
      let selfCollectedCash = new Prisma.Decimal(0);
      let netPayable = new Prisma.Decimal(0);

      for (const order of shopOrders) {
        grossSales = grossSales.plus(order.grandTotal);
        commission = commission.plus(order.platformCommission);
        netPayable = netPayable.plus(order.shopPayable);

        const payment = order.payment;
        if (payment?.method === 'COD' && payment.status === 'PAID') {
          // ⚠️ Answered 2026-08-09 (HANDOFF §7.8a), the standard model in this
          // market: when the PLATFORM's rider collects cash he remits it to the
          // platform, which then settles net to the shop — that is
          // `codCollected`, and `netPayable` above is right for it. When the
          // SHOP'S OWN boy collects, the shop already has the money, so paying
          // `shopPayable` out again would be paying the same sale twice. The
          // platform deducts rather than collects, which is also the only
          // version that does not have us chasing a shop's employee for cash.
          if (payment.collectedByRider?.employerShopId === shopId) {
            selfCollectedCash = selfCollectedCash.plus(payment.amount);
          } else {
            codCollected = codCollected.plus(payment.amount);
          }
        }
      }

      // ⚠️ This can legitimately go NEGATIVE, and that is the point rather than
      // a bug to clamp: a shop whose own boys delivered every COD order that
      // week is holding money the platform is owed, so the settlement is an
      // invoice to the shop instead of a payout to it. Clamping at zero would
      // silently write that debt off every week.
      netPayable = netPayable.minus(selfCollectedCash);

      const created = await tx.settlement.create({
        data: {
          shopId,
          periodStart,
          periodEnd,
          grossSales,
          commission,
          codCollected,
          // The shop is holding this cash already — recorded as a deduction
          // because that is exactly what it is, and it is the first thing ever
          // to make this column non-zero (shop *penalties* stay 0 in year one,
          // HANDOFF §3 — this is not one).
          deductions: selfCollectedCash,
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
      // ⚠️ **Every rider is settled, including a shop's own delivery boy.**
      // Reversed on the client call of 2026-08-09, along with the pay decision
      // in `riderPay.js` — the platform pays "everyone", so there is now
      // something to settle for a shop's employee and excluding him would mean
      // earning him money the run never pays out. The `rider: { employerShopId:
      // null }` filter that used to sit here is deliberately gone.
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
