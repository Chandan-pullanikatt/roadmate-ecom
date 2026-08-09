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

/**
 * @param {() => Promise<any>} fetcher
 * @param {{intervalMs?: number, enabled?: boolean, deps?: any[]}} [options]
 */
export function useResource(fetcher, { intervalMs, enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const load = useCallback(async ({ silent } = {}) => {
    if (pausedRef.current > 0) return;
    if (!silent) setRefreshing(true);
    try {
      const result = await fetcherRef.current();
      if (!mountedRef.current || pausedRef.current > 0) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      // A failed background poll keeps the last good data on screen — a rider
      // riding through a dead spot should not lose the address they are riding
      // to, and a customer watching an order should not lose it either. The
      // error is still surfaced so the screen can show a banner.
      setError(err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
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

  return { data, error, loading, refreshing, reload: load, withPause, setData };
}
