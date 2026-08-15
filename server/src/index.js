import dotenv from 'dotenv';

dotenv.config();

// dotenv must run before app.js is evaluated — it reads CORS_ORIGIN at import
// time — so this is a dynamic import, not a static one.
const { default: app, allowedOrigins } = await import('./app.js');

const PORT = process.env.PORT || 5000;

console.log('CORS allowed origins:', allowedOrigins);

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` RoadMate B2B2C API Server running on port ${PORT}`);
  console.log(` Active Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`==================================================`);
});

// The accept window, on a host that only gives us one process (2026-08-13).
//
// ⚠️ **Off by default, and it should stay off wherever a second process is
// possible.** `npm run sweeper` is still the right way to run this: a sweep
// living inside the web service stops when the web service does, and a free
// tier that spins down after fifteen idle minutes is exactly such a host — the
// first request after a cold start wakes the API *and* the sweeper, so an offer
// that expired during the sleep is swept a moment late rather than never.
//
// It is here because without *some* sweeper no accept window ever expires, no
// offer times out and no order ever reroutes — three of the things a demo is
// meant to show — and a free single-process host cannot run a worker at all.
// One replica is plenty; two are safe (the work is claimed per row), so this
// being on alongside a real sweeper is harmless rather than double-counting.
if (String(process.env.RUN_SWEEPER_IN_PROCESS).toLowerCase() === 'true') {
  const { startSweeper } = await import('./jobs/sweeperLoop.js');
  startSweeper();
}

// The three maintenance jobs, on the same kind of host and for the same reason
// (2026-08-16). See `jobs/scheduler.js` for what each one costs if it never
// runs — the short version is that without `billing` nobody is ever invoiced,
// and subscriptions are the platform's whole income.
//
// A **separate flag** from the sweeper above, deliberately. They are different
// obligations: the sweeper is a continuous loop enforcing a 60-second window
// and is correctness-critical, while these are daily maintenance. A host with a
// real worker but no cron wants one of these flags and not the other. A
// single-service free tier sets both.
if (String(process.env.RUN_JOBS_IN_PROCESS).toLowerCase() === 'true') {
  const { startJobs } = await import('./jobs/scheduler.js');
  startJobs();
}
