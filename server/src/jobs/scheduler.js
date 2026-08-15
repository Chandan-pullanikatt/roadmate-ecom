// The three maintenance jobs, on a timer inside the API process.
//
// `npm run billing`, `npm run settlement` and `npm run prune:uploads` are
// one-shot scripts meant for cron. A host that gives us **one process and no
// cron** — which is every free tier, and Render's in particular — has nowhere
// to point cron at, and the consequence is not cosmetic:
//
//   • without `billing`, **nobody is ever invoiced**, and partner subscriptions
//     are the platform's entire income since `commission_percent` went to 0 on
//     the 2026-08-09 call;
//   • without `settlement`, no shop and no rider is ever paid;
//   • without `prune:uploads`, the honest answer to "how long do you keep
//     photographs of customers' front doors" is "forever", whatever
//     `pod_photo_retention_days` says.
//
// This is the same trade `RUN_SWEEPER_IN_PROCESS` makes in `src/index.js`, for
// the same reason and with the same warning attached.
//
// ⚠️ **Off by default (`RUN_JOBS_IN_PROCESS`), and it should stay off wherever
// real cron exists.** A job living inside the web service does not run while the
// web service is spun down, so on a free tier these fire only when somebody is
// awake to have woken it. That is survivable *here* and nowhere else, because
// all three are idempotent and self-healing by design: billing is bounded by
// `@@unique([subscriptionId, periodStart])`, settlement skips any order already
// on a `SettlementLine` and any shop+period already settled, and prune deletes
// by age. A day missed is a day caught up on the next run, not a day lost.
//
// ⚠️ **Two instances running these at once is safe** — the same claim
// discipline that makes two sweepers safe — so this being on alongside real
// cron duplicates work rather than double-paying anybody.
import { runSettlement, runRiderSettlement } from '../lib/settlement.js';
import { runBilling } from '../lib/subscription.js';
import { prunePodPhotos } from './pruneUploads.js';
import { defaultWindow } from './runSettlement.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// **All three run daily, settlement included**, and that is deliberate rather
// than lazy. `runSettlement` settles the last *completed* week, so six runs in
// seven find the week already settled and do nothing — which is precisely what
// makes a missed Monday heal itself on Tuesday. A timer that fires "weekly"
// inside a process that restarts whenever the host feels like it is a timer
// that fires approximately never. This is the same argument `runBilling.js`
// already makes in its own header for billing daily rather than monthly.
const INTERVAL_MS = Number.parseInt(process.env.JOBS_INTERVAL_MS || String(DAY_MS), 10);

// Nothing runs for the first minute of a process's life. A cold start on a free
// tier is somebody's first page load — the client opening the app — and three
// maintenance jobs competing with it for the same single CPU and the same Neon
// connection pool is the one moment they must not run. It also means a service
// that only ever wakes briefly never runs them at all, which is the correct
// outcome: they are maintenance, not request handling.
const FIRST_RUN_DELAY_MS = Number.parseInt(process.env.JOBS_FIRST_RUN_DELAY_MS || '60000', 10);

// ...and they are staggered from each other for the same reason.
const STAGGER_MS = 20_000;

/** @type {Array<NodeJS.Timeout>} */
const timers = [];
let started = false;

/**
 * Run one job, and never let it take the API down.
 *
 * An unhandled rejection in a timer callback is a process-level crash in modern
 * Node. A settlement run that throws because Cloudinary is unreachable, or
 * because somebody's fee row is malformed, must cost us that run and nothing
 * else — the web service is still serving customers.
 */
async function safely(name, run) {
  const startedAt = Date.now();
  try {
    await run();
    console.log(`[jobs] ${name} ok (${Date.now() - startedAt}ms)`);
  } catch (error) {
    console.error(`[jobs] ${name} failed:`, error?.message ?? error);
  }
}

const JOBS = [
  {
    name: 'billing',
    run: () => runBilling({ now: new Date() })
  },
  {
    name: 'settlement',
    // Shops and riders in one run: they are one weekly obligation, and one
    // thing to schedule is one thing that can fail. `runSettlement.js` pairs
    // them the same way for the same reason.
    run: async () => {
      const { periodStart, periodEnd } = defaultWindow();
      await runSettlement({ periodStart, periodEnd });
      await runRiderSettlement({ periodStart, periodEnd });
    }
  },
  {
    name: 'prune-uploads',
    // No-ops without Cloudinary credentials, like every other seam that talks
    // to a third party here.
    run: () => prunePodPhotos({})
  }
];

/** Start the timers. Idempotent — calling it twice does not double-schedule. */
export function startJobs() {
  if (started) return;
  started = true;

  console.log(
    `[jobs] in-process scheduler on — ${JOBS.length} jobs, every ${Math.round(INTERVAL_MS / 60000)}min, ` +
      `first run in ${Math.round(FIRST_RUN_DELAY_MS / 1000)}s`
  );

  JOBS.forEach((job, index) => {
    const first = setTimeout(() => {
      void safely(job.name, job.run);
      const repeat = setInterval(() => void safely(job.name, job.run), INTERVAL_MS);
      // `unref` so a pending timer never holds the process open on shutdown.
      repeat.unref?.();
      timers.push(repeat);
    }, FIRST_RUN_DELAY_MS + index * STAGGER_MS);
    first.unref?.();
    timers.push(first);
  });
}

/** Stop every timer. For a clean shutdown, and for tests. */
export function stopJobs() {
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  timers.length = 0;
  started = false;
}
