// Phase 1.5 — the sweeper process. `npm run sweeper`.
//
// A separate process, not an Express route. The 60-second accept window is
// enforced by wall-clock time passing, not by anybody making a request, and an
// endpoint that "runs the sweep" would mean an order times out only if traffic
// happens to arrive. Run this alongside the API (pm2, a systemd unit, a k8s
// Deployment — one replica is plenty, but two are safe).
//
// Nothing here holds state. If it is killed mid-sweep the next tick — or the
// other replica — picks up exactly where it stopped, because the work is claimed
// per row and never in memory. That is the whole reason `sweepAttempts.js` is
// written the way it is.
import prisma from '../lib/prisma.js';
import { sweepExpiredAttempts, recoverStalledOrders } from './sweepAttempts.js';

// A tick well under the shortest sensible accept window: the visible cost of a
// timeout is `accept_window + up to one tick`, and 5s of slop on a 60s promise
// is invisible to the customer.
const TICK_MS = Number.parseInt(process.env.SWEEPER_TICK_MS || '5000', 10);

let running = false; // one sweep at a time *within* this process
let stopping = false;
let timer = null;

async function tick() {
  if (running || stopping) return;
  running = true;

  try {
    const now = new Date();
    const swept = await sweepExpiredAttempts({ now });
    const recovered = await recoverStalledOrders({ now });

    // Only speak when something happened — a quiet sweeper must stay quiet, or
    // the log becomes unreadable and nobody notices the line that matters.
    if (swept.rerouted || swept.cancelled) {
      console.log(
        `[sweeper] timed out ${swept.examined} offer(s): ${swept.rerouted} rerouted, ${swept.cancelled} cancelled`
      );
    }
    if (recovered.rerouted || recovered.cancelled) {
      console.warn(
        `[sweeper] recovered ${recovered.examined} stalled order(s): ${recovered.rerouted} rerouted, ${recovered.cancelled} cancelled`
      );
    }
  } catch (error) {
    // Never rethrow: a transient database blip must not kill the process that
    // enforces every accept window on the platform.
    console.error('[sweeper] tick failed:', error);
  } finally {
    running = false;
  }
}

export function startSweeper() {
  console.log(`[sweeper] started, tick ${TICK_MS}ms`);
  timer = setInterval(tick, TICK_MS);
  void tick(); // don't make the first order wait a full tick
  return timer;
}

async function shutdown(signal) {
  stopping = true;
  clearInterval(timer);
  console.log(`[sweeper] ${signal} — draining`);

  // Let an in-flight sweep finish its transaction rather than orphaning a claim.
  while (running) await new Promise((r) => setTimeout(r, 50));

  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

startSweeper();
