// Phase 1.8 — the weekly settlement run. `npm run settlement`.
//
// A one-shot script, not a long-running process like `sweeper.js` — it does
// one week's worth of work and exits. Point cron (or a k8s CronJob) at it
// once a week. Safe to re-run: `runSettlement()` in `lib/settlement.js` skips
// any shop+period it has already settled and any order already on a
// `SettlementLine`.
//
// Defaults to the most recently completed Mon 00:00 → Mon 00:00 week in UTC.
// Pass explicit ISO dates to settle a different window by hand:
//   node src/jobs/runSettlement.js 2026-08-03T00:00:00Z 2026-08-10T00:00:00Z
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';
import { runSettlement, runRiderSettlement } from '../lib/settlement.js';

dotenv.config();

/** The most recent Monday 00:00 UTC strictly before `now`. */
function lastMonday(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since the most recent Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * The most recently *completed* Mon 00:00 → Mon 00:00 week, in UTC.
 *
 * Exported since 2026-08-16 so the in-process scheduler (`jobs/scheduler.js`)
 * settles exactly the window this script does. Two copies of week-boundary
 * arithmetic is how a cron run and an in-process run come to disagree about
 * which week they are paying out — and both would look correct in isolation.
 */
export function defaultWindow(now = new Date()) {
  const periodEnd = lastMonday(now); // this week's Monday...
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - 7); // ...so periodStart is last week's.
  return { periodStart, periodEnd };
}

async function main() {
  const [startArg, endArg] = process.argv.slice(2);
  const { periodStart, periodEnd } = startArg && endArg
    ? { periodStart: new Date(startArg), periodEnd: new Date(endArg) }
    : defaultWindow();

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
    console.error('[settlement] invalid period:', { periodStart, periodEnd });
    process.exitCode = 1;
    return;
  }

  console.log(`[settlement] running ${periodStart.toISOString()} -> ${periodEnd.toISOString()}`);
  const result = await runSettlement({ periodStart, periodEnd });
  console.log(`[settlement] ${result.shopCount} shop(s) settled`);

  // Riders are paid by the same run: they are independent partners, and one
  // weekly job is one thing to schedule and one thing that can fail.
  const riders = await runRiderSettlement({ periodStart, periodEnd });
  console.log(`[settlement] ${riders.riderCount} rider(s) settled`);
}

// Only when invoked directly, so `defaultWindow` above can be imported without
// settling a week as a side effect — the same guard `pruneUploads.js` uses.
if (process.argv[1] && process.argv[1].endsWith('runSettlement.js')) {
  main()
    .catch((err) => {
      console.error('[settlement] failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
