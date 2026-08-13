// Phase 1.5 — the sweeper process. `npm run sweeper`.
//
// A separate process, not an Express route. The 60-second accept window is
// enforced by wall-clock time passing, not by anybody making a request, and an
// endpoint that "runs the sweep" would mean an order times out only if traffic
// happens to arrive. Run this alongside the API (pm2, a systemd unit, a k8s
// Deployment — one replica is plenty, but two are safe).
//
// This file is now only the *entrypoint*: the loop lives in `sweeperLoop.js`, so
// that a host which cannot give us a second process can run the same code inside
// the API instead (see `RUN_SWEEPER_IN_PROCESS` in `src/index.js`). Running it
// here is still the right way — a sweep that stops because the web service was
// scaled to zero is a stopped sweep.
import prisma from '../lib/prisma.js';
import { startSweeper, stopSweeper } from './sweeperLoop.js';

async function shutdown(signal) {
  console.log(`[sweeper] ${signal} — draining`);
  await stopSweeper();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

startSweeper();
