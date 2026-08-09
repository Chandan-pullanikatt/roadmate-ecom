// Phase 1.5 — the timeout sweeper.
//
// Express does no scheduled work, so the 60-second accept window has to be
// enforced by something that wakes up on its own. This module is the work; the
// process that calls it on a timer is `sweeper.js` next door.
//
// IDEMPOTENT BY CONSTRUCTION. Assume two copies run at once — they will, in dev
// and under pm2. Nothing here decides "this offer has expired" and then acts on
// that belief; every action is a conditional `updateMany` whose WHERE clause
// re-checks the reason for acting, and a count of 0 means another worker won and
// this one must do nothing at all. See `advanceOrder()` in `lib/routing.js`.
//
// `now` is a parameter, never `new Date()` at the point of use, so tests can
// express "the window has elapsed" without sleeping.
import prisma from '../lib/prisma.js';
import {
  advanceOrder,
  releaseLines,
  orderLines,
  recomputeFulfilmentRate,
  routeToNext
} from '../lib/routing.js';
import { rankCandidateShops } from '../lib/shopRanking.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';

const tally = (results) => ({
  examined: results.length,
  rerouted: results.filter((r) => r.outcome === 'REROUTED').length,
  cancelled: results.filter((r) => r.outcome === 'CANCELLED').length,
  skipped: results.filter((r) => r.outcome === 'SKIPPED').length
});

/**
 * Time out every offer whose window has closed and re-offer each order to the
 * next-ranked shop — the silent reroute from HANDOFF §3.
 *
 * Reads `@@index([status, expiresAt])` on `FulfilmentAttempt`, which exists for
 * exactly this query. The `findMany` is only a shortlist: the authoritative
 * check is the claim inside `advanceOrder`, so a row that another worker takes
 * between the two simply comes back SKIPPED.
 *
 * @param {{now?: Date, limit?: number}} [options]
 */
export async function sweepExpiredAttempts({ now = new Date(), limit = 200 } = {}) {
  const due = await prisma.fulfilmentAttempt.findMany({
    where: { status: 'OFFERED', expiresAt: { lt: now } },
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
    take: limit
  });

  const results = [];
  for (const { id } of due) {
    // Sequentially, not Promise.all: two reroutes in flight would contend for
    // the same shelves, and a sweep is not on anybody's latency path.
    results.push(
      await advanceOrder({
        attemptId: id,
        fromStatus: 'OFFERED',
        terminalStatus: 'TIMED_OUT',
        reason: 'Shop did not respond within the accept window.',
        now,
        requireExpired: true
      })
    );
  }

  return tally(results);
}

/**
 * Pick up orders that are ROUTING with no live offer.
 *
 * This is the crash net. `advanceOrder` closes an attempt and opens the next one
 * in one transaction, so an order cannot reach this state by losing a race — only
 * by the process dying at the wrong instant, or by an operator editing rows. The
 * consequence of not handling it is the worst kind: an order nobody is looking
 * at, holding stock the shop cannot sell, forever.
 *
 * The claim is a no-op write to the order: `updateMany` bumps `@updatedAt`, so
 * the winner moves the row out of its own `updatedAt < cutoff` window and a
 * second worker's claim matches zero rows.
 *
 * @param {{now?: Date, staleAfterSeconds?: number, limit?: number}} [options]
 */
export async function recoverStalledOrders({ now = new Date(), staleAfterSeconds, limit = 100 } = {}) {
  const graceSeconds =
    staleAfterSeconds ?? (await getConfigNumber(CONFIG_KEYS.ACCEPT_WINDOW_SECONDS, null));
  const cutoff = new Date(now.getTime() - graceSeconds * 1000);

  const stalled = await prisma.consumerOrder.findMany({
    where: {
      status: 'ROUTING',
      updatedAt: { lt: cutoff },
      attempts: { none: { status: 'OFFERED' } }
    },
    select: { id: true },
    take: limit
  });

  const results = [];
  for (const { id } of stalled) {
    results.push(await resumeOrder(id, now, cutoff));
  }

  return tally(results);
}

async function resumeOrder(orderId, now, cutoff) {
  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId },
    include: { items: true, address: true, attempts: true, payment: true }
  });
  if (!order) return { outcome: 'SKIPPED', reason: 'GONE' };

  const lines = orderLines(order);
  const tried = order.attempts.map((a) => a.shopId);
  const candidates = await rankCandidateShops(
    order.address.latitude,
    order.address.longitude,
    order.industryId,
    { excludeShopIds: tried, requireStock: lines }
  );

  const holder = [...order.attempts].sort((a, b) => b.sequence - a.sequence)[0];
  const nextSequence = (holder?.sequence ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.consumerOrder.updateMany({
      where: { id: orderId, status: 'ROUTING', updatedAt: { lt: cutoff } },
      data: { status: 'ROUTING' } // touches @updatedAt — that is the claim
    });
    if (claimed.count === 0) return { outcome: 'SKIPPED', reason: 'LOST_RACE' };

    // The stalled order's stock is still held by whichever shop was last
    // offered it — the reroute has to hand it over, exactly as a timeout does.
    if (holder) {
      await releaseLines(tx, holder.shopId, lines);
      await recomputeFulfilmentRate(tx, holder.shopId);
    }

    return routeToNext(tx, { order, lines, candidates, now, sequence: nextSequence });
  });
}
