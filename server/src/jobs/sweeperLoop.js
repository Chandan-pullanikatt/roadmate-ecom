// The sweep loop itself, with no side effects on import (2026-08-13).
//
// This is `sweeper.js`'s body, lifted out unchanged so it has **two** callers:
// the standalone process (`npm run sweeper`), which is still the right way to
// run this, and the API process on a host that cannot give us a second one.
//
// ⚠️ Importing this module starts nothing. `sweeper.js` used to be both the loop
// and its entrypoint, so importing it anywhere started a timer, registered
// signal handlers and installed a `process.exit`. That is fine for a file whose
// only job is to be run, and unusable from inside a server.
//
// Everything the original said still holds: nothing here holds state, the work
// is claimed per row rather than in memory, and a process killed mid-sweep is
// picked up by the next tick or the other replica.
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

/** Idempotent — a second call is a no-op rather than a second timer. */
export function startSweeper() {
  if (timer) return timer;
  console.log(`[sweeper] started, tick ${TICK_MS}ms`);
  timer = setInterval(tick, TICK_MS);
  void tick(); // don't make the first order wait a full tick
  return timer;
}

/** Stop ticking and let an in-flight sweep finish its transaction. */
export async function stopSweeper() {
  stopping = true;
  clearInterval(timer);
  timer = null;
  while (running) await new Promise((r) => setTimeout(r, 50));
}
