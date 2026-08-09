// Where the API is, and how often each screen re-asks it.
//
// `localhost` is the one value that is always wrong on a physical device: the
// phone resolves it to itself. In development the URL must be the dev machine's
// LAN address, which is why this reads an env var first — `EXPO_PUBLIC_*` is
// inlined into the bundle by Expo and needs no config-plugin work.
import Constants from 'expo-constants';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants.expoConfig?.extra?.apiUrl ??
  'http://localhost:5000';

/**
 * How often a list re-asks the server.
 *
 * The rider's numbers are deliberately slower than the shop's. The shop has a
 * 60-second window with a countdown on it, so latency there *is* the product;
 * a rider has no timer to lose. What a rider does have is a phone in a pocket
 * on a motorbike, on mobile data, all day — so every one of these intervals is
 * battery and somebody's data allowance, and the job list is the only one that
 * has to feel live.
 */
export const POLL_MS = {
  // A job appears here without being asked for: assignment happens when the
  // shop marks the order READY. Ten seconds is what turns that into "it just
  // showed up" rather than "I had to pull to refresh".
  jobs: 10000,
  // Money that only changes when this rider completes a delivery — and after
  // one, the screen is refreshed from the action's own result anyway.
  earnings: 60000,
  cash: 60000
};

/**
 * How often the phone tells the platform where it is, **while on shift only**.
 *
 * This is not telemetry. `freeRidersNear()` and `hasRiderCoverage()` read
 * `lastLat`/`lastLng`, so a rider whose location goes stale stops being
 * assignable and can take their whole area out of serviceability with them
 * (HANDOFF §3). Twenty seconds is well inside any assignment decision and is
 * roughly a city block at delivery speed.
 *
 * There is no pings-history table by design — each report overwrites the last,
 * so the cost of this interval is bandwidth, never storage.
 */
export const LOCATION_MS = 20000;
