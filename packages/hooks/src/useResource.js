// A small fetch-with-polling hook — one copy, for all three apps.
//
// **Why this is a package now.** It began as one file in `apps/business` and was
// copied into `apps/rider`, with a note saying the duplication was the cheaper
// trade at two copies and that "if `apps/consumer` makes it three copies, that
// trade flips" (HANDOFF §6, Phase 3). Phase 4 is that third copy, so this is the
// promised move: the two files were byte-identical apart from their comments,
// and a bug fixed in two places out of three is worse than no shared code at all.
//
// It could not live in either existing package: `@roadmate/ui` is the design
// system with no navigation in it, and `@roadmate/api` is the endpoints with no
// React in it. Both are libraries of values; this is runtime behaviour, and it
// needs its own home rather than a hole in one of theirs.
//
// The rule the timer must respect: **a poll must never overwrite an in-flight
// action's result.** A shop taps Accept, the request is in flight, a 5-second
// poll lands with the pre-accept list, and the order reappears in the inbox it
// just left. `withPause` is what the action handlers use to prevent that, and
// every mutating tap in all three apps goes through it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

// ── The answer cache ─────────────────────────────────────────────────────────
//
// **What this fixes.** Every mount started at `data: null`, so every navigation
// was a cold start: tap a shop, go back, tap it again — full skeleton and a full
// refetch, both times. Worse on the home screen, where changing the industry
// rail nulls four resources at once and blanks the whole page while five
// requests fly. That is the "lag" people mean; the data is not slow to *arrive*
// so much as it is absent at the moment they look.
//
// So an answer is kept, and a screen that has asked its question before paints
// from memory in the first frame and revalidates underneath. `useFocusEffect`
// below already refetches on focus, so this needed no new fetching — only
// somewhere for the previous answer to live between two mounts.
//
// ⚠️ **Caching is opt-in via `cacheKey`, and that is not timidity.** `deps`
// alone cannot identify an answer: `app/shop/[shopId].js` holds two resources
// that both pass `deps: [shopId]` — the shelf and the carts — and keying on deps
// would serve one screen the other's payload. A call site that passes no
// `cacheKey` behaves exactly as it did before, which is what makes this safe to
// land across three apps at once.
//
// ⚠️ **The cache is per signed-in session and must be dropped on sign-out.**
// A cart, an order list and an address book are one customer's. `clearResourceCache()`
// is exported for exactly that and is called from each app's `signOut`.
//
// ⚠️ **Passing a `cacheKey` promotes `deps` from a hint to a contract: every
// input the fetcher varies on must appear in it.** Without a key that is merely
// untidy — the focus effect re-runs on deps, so a missing one only costs a
// refetch. With a key it is a correctness bug, because the answer is now filed
// under those deps and served back for them. `apps/business/app/(shop)/stock.js`
// is the live example of the shape to watch for: its fetcher closes over a
// search term that is in no `deps` array, so it is deliberately left uncached.
const CACHE_MAX_ENTRIES = 120;
/** Older than this and the answer is not worth showing before the new one lands. */
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

/** `${cacheKey}|${depsKey}` → `{ data, at }`, in least-recently-used order. */
const cache = new Map();

/** The entry, or `undefined` for a miss — never the data itself, which may be null. */
function cacheRead(key, maxAgeMs) {
  if (!key) return undefined;
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > maxAgeMs) {
    cache.delete(key);
    return undefined;
  }
  // Re-insert to move it to the end: `Map` keeps insertion order, which is what
  // makes the eviction below least-recently-used rather than arbitrary.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheWrite(key, data) {
  if (!key) return;
  cache.delete(key);
  cache.set(key, { data, at: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

/**
 * Forget every cached answer.
 *
 * Call this on sign-out. Not doing so is how the next person to sign in on a
 * shared phone sees the last one's basket for a frame.
 */
export function clearResourceCache() {
  cache.clear();
}

/**
 * @param {() => Promise<any>} fetcher
 * @param {{intervalMs?: number, enabled?: boolean, deps?: any[], cacheKey?: string,
 *   cacheMaxAgeMs?: number}} [options]
 */
export function useResource(
  fetcher,
  { intervalMs, enabled = true, deps = [], cacheKey, cacheMaxAgeMs = DEFAULT_MAX_AGE_MS } = {}
) {
  const depsKey = JSON.stringify(deps);
  // No `cacheKey` is no caching: `fullKey` stays null and every helper above is
  // a no-op on it.
  const fullKey = cacheKey ? `${cacheKey}|${depsKey}` : null;

  // Lazy initialisers, so the two lookups happen on mount and not per render.
  const [data, setDataState] = useState(() => cacheRead(fullKey, cacheMaxAgeMs)?.data ?? null);
  const [error, setError] = useState(null);
  // The point of the whole file: a cache hit is not a loading state, so no
  // skeleton is rendered over an answer we already have.
  const [loading, setLoading] = useState(() => !cacheRead(fullKey, cacheMaxAgeMs));
  const [refreshing, setRefreshing] = useState(false);

  // `load` and the wrapped `setData` are both `useCallback([])` — stable for the
  // life of the hook — so they cannot close over a key that changes with deps.
  const keyRef = useRef(fullKey);
  keyRef.current = fullKey;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const pausedRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Which question is on screen, and only ever its own answer ──────────────
  //
  // `deps` is what the data is *about* — a shop id, an order id, an industry, a
  // category, a typed query. Every call site passes an identity, never a
  // cosmetic value, and that is what makes the two guards below safe.
  //
  // ⚠️ **`data` used to survive a change of `deps`.** Nothing cleared it, so the
  // hook answered the *new* question with the *old* answer until the fetch came
  // back: tapping Snacks rendered the previous category's products under the
  // Snacks heading, with its filter chip, and then silently swapped them a
  // moment later. Nobody watching that sees a loading state — they see a shop
  // that stocks bread under Snacks, and the correction looks like the list
  // changing its mind. The reset happens during render rather than in an effect
  // precisely because an effect would commit one frame of the stale list first,
  // which is the frame being complained about.
  //
  // The cache does not weaken any of that, because it is keyed by `deps` too: a
  // hit here is the previous answer to **this** question, not to the one being
  // navigated away from. Tapping Snacks now shows the Snacks list you saw a
  // minute ago while the fresh one loads, and never bread.
  const [seenKey, setSeenKey] = useState(depsKey);
  // The sequence number a response must still hold to be allowed to land.
  const seqRef = useRef(0);

  if (depsKey !== seenKey) {
    setSeenKey(depsKey);
    const cached = cacheRead(fullKey, cacheMaxAgeMs);
    setDataState(cached ? cached.data : null);
    setError(null);
    setLoading(!cached);
    // ⚠️ The subtler half, and a real bug rather than a cosmetic one: a request
    // for the *previous* deps may still be in flight. Without this bump it
    // resolves after the switch and repopulates `data` with the old category's
    // products — permanently, not for a frame, because nothing fetches again
    // until the next poll. Bumping here retires it; `load` below refuses any
    // response whose ticket is no longer current, which also fixes two requests
    // for different categories resolving out of order.
    seqRef.current += 1;
  }

  const load = useCallback(async ({ silent } = {}) => {
    if (pausedRef.current > 0) return;
    const seq = (seqRef.current += 1);
    if (!silent) setRefreshing(true);
    try {
      const result = await fetcherRef.current();
      if (pausedRef.current > 0) return;
      // Superseded while in flight — by a newer poll, or by the deps changing
      // out from under it. Its answer is to a question nobody is asking now.
      if (seq !== seqRef.current) return;
      // Cached before the mounted check, deliberately: a request that resolves
      // just after somebody navigated away is still the current answer to a
      // question they are likely to ask again, and it is the tap straight back
      // that this whole file exists to make instant.
      cacheWrite(keyRef.current, result);
      if (!mountedRef.current) return;
      setDataState(result);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (seq !== seqRef.current) return;
      // A failed background poll keeps the last good data on screen — a rider
      // riding through a dead spot should not lose the address they are riding
      // to, and a customer watching an order should not lose it either. The
      // error is still surfaced so the screen can show a banner.
      setError(err);
    } finally {
      if (mountedRef.current) {
        // ⚠️ `loading` is sequence-guarded and the pull-to-refresh spinner is
        // not, and the asymmetry is the point. If a superseded request cleared
        // `loading`, the screen would sit at `data === null, loading === false`
        // until the current request landed — which every screen here renders as
        // its **empty state**. Switching category would flash "No shop near you
        // lists this at all": a stronger and more alarming false claim than the
        // stale list this whole change exists to remove. A newer request is
        // always in flight when a request is superseded (the deps change is what
        // re-runs the focus effect), so it is that one's job to end the load.
        if (seq === seqRef.current) setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Refetch whenever the screen comes back into view: putting the phone away and
  // taking it out again is asking "what is true now".
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      load({ silent: true });
      if (!intervalMs) return undefined;
      const id = setInterval(() => load({ silent: true }), intervalMs);
      return () => clearInterval(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, intervalMs, load, ...deps])
  );

  /**
   * Run an action with polling suspended, then refresh once from its result.
   * Every mutating tap in every app goes through here.
   */
  const withPause = useCallback(
    async (action) => {
      pausedRef.current += 1;
      try {
        return await action();
      } finally {
        pausedRef.current -= 1;
        // Deliberately after the action resolves *and* after the pause lifts, so
        // the refresh sees the server's post-action state.
        load({ silent: true });
      }
    },
    [load]
  );

  /**
   * Set the data by hand — the optimistic-update escape hatch.
   *
   * It writes through to the cache, and it has to: a screen that flips a toggle
   * locally and then navigates away would otherwise come back to the cached
   * pre-tap value and appear to have undone itself.
   */
  const setData = useCallback((next) => {
    if (typeof next === 'function') {
      setDataState((current) => {
        const value = next(current);
        cacheWrite(keyRef.current, value);
        return value;
      });
      return;
    }
    cacheWrite(keyRef.current, next);
    setDataState(next);
  }, []);

  return { data, error, loading, refreshing, reload: load, withPause, setData };
}
