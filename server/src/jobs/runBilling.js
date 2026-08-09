// HANDOFF §7ter — the monthly subscription run. `npm run billing`.
//
// A one-shot script like `runSettlement.js`, not a long-running process like
// the sweeper: it issues whatever invoices are owed and exits. Point cron at it
// **daily**. Monthly would work too, but daily is strictly better and costs
// nothing: an invoice is only ever created for a period that has already
// started, so a daily run issues each partner's bill on their own anniversary
// date rather than everybody's on the 1st, and a day the server was down
// self-heals the next morning instead of a month later.
//
// Safe to re-run, by the same mechanism as settlement: `@@unique(
// [subscriptionId, periodStart])` means a period already invoiced cannot be
// invoiced twice, and running it four times in one hour issues nothing new.
//
// Pass an ISO date to bill as if it were that day — used to check what a run
// will do before letting cron do it:
//   node src/jobs/runBilling.js 2026-11-08T00:00:00Z
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';
import { runBilling } from '../lib/subscription.js';

dotenv.config();

// Why a partner was passed over. All five are normal; two are somebody's job.
const SKIP_LABELS = {
  TRIAL: 'still in the free trial',
  ALREADY_INVOICED: 'already invoiced for every period so far',
  CANCELLED: 'cancelled',
  // ⚠️ These two are the ones to act on. Neither is visible from any other
  // screen, and both mean a partner who is trading and not being billed.
  FEE_NOT_SET: '⚠️  NO FEE CONFIGURED — not billed',
  NO_APPROVAL_DATE: '⚠️  no approval date — trial cannot be dated, not billed'
};

async function main() {
  const [whenArg] = process.argv.slice(2);
  const now = whenArg ? new Date(whenArg) : new Date();

  if (Number.isNaN(now.getTime())) {
    console.error('[billing] invalid date:', whenArg);
    process.exitCode = 1;
    return;
  }

  console.log(`[billing] running as at ${now.toISOString()}`);
  const result = await runBilling({ now });

  for (const p of result.partners) {
    console.log(`[billing]   ${p.role} ${p.name} (#${p.userId}) — ${p.count} invoice(s)`);
  }
  console.log(`[billing] ${result.issued} invoice(s) issued, ₹${result.totalAmount.toFixed(2)} billed`);

  for (const [reason, count] of Object.entries(result.skipped)) {
    console.log(`[billing] ${count} partner(s) skipped: ${SKIP_LABELS[reason] ?? reason}`);
  }
}

main()
  .catch((err) => {
    console.error('[billing] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
