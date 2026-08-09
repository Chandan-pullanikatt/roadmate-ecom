// Where the rider is, reported to the platform while — and only while — the
// shift is on.
//
// **This is not analytics, and it is not the customer's live map.** It is the
// input to the two functions that decide who gets work:
// `freeRidersNear()` picks the rider for a job from `lastLat`/`lastLng`, and
// `hasRiderCoverage()` decides whether an area is serviceable at all. A rider
// whose position goes stale quietly stops being offered anything, and — because
// serviceability is "a shop in range **and** a rider on shift in range" — can
// take a whole neighbourhood's shops off the customer app with them. So the
// failure mode this hook exists to prevent is silence, which is why it reports
// its own state back to the screen instead of failing invisibly.
//
// Three deliberate limits:
//
//   • **Foreground permission only.** Background location is a Play Store
//     review conversation and a battery cost, and nothing in Phase 3 needs a
//     position while the app is closed — a rider mid-delivery has the app open.
//     Asking for "always" would be asking for more than the product uses.
//   • **Off shift means nothing is sent.** Not a slower interval — nothing. A
//     rider who has finished for the day is not the platform's to follow.
//   • **A failed report is dropped, never queued.** Each report overwrites the
//     last on the server (there is no pings-history table by design), so a
//     position from four minutes ago has no value once a newer one exists.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { LOCATION_MS } from './config.js';

/**
 * @param {object} options
 * @param {boolean} options.active usually the shift flag
 * @param {(lat: number, lng: number) => Promise<any>} options.report
 */
export function useLocationReporting({ active, report }) {
  // 'idle' | 'starting' | 'reporting' | 'denied' | 'unavailable'
  const [status, setStatus] = useState('idle');
  const [lastReportedAt, setLastReportedAt] = useState(null);

  const reportRef = useRef(report);
  reportRef.current = report;

  // Guards against two reports overlapping when a fix takes longer than the
  // interval — a slow GPS lock on a cold start easily can.
  const busyRef = useRef(false);

  const reportOnce = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      await reportRef.current(position.coords.latitude, position.coords.longitude);
      setLastReportedAt(new Date());
      setStatus('reporting');
    } catch {
      // A dead spot or a refused fix. Nothing is queued — see the note above.
      // `status` is left alone so one failed report does not make a working
      // shift look broken; `lastReportedAt` going stale is the honest signal,
      // and it is what the home screen shows.
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      return undefined;
    }

    let cancelled = false;
    let timer = null;

    (async () => {
      setStatus('starting');

      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!permission.granted) {
        // Deliberately not retried in a loop. The rider has to change this in
        // the OS settings, and the screen tells them so.
        setStatus('denied');
        return;
      }

      const enabled = await Location.hasServicesEnabledAsync();
      if (cancelled) return;
      if (!enabled) {
        setStatus('unavailable');
        return;
      }

      await reportOnce();
      if (cancelled) return;
      timer = setInterval(reportOnce, LOCATION_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [active, reportOnce]);

  // Coming back from the background is the moment the position is most likely
  // to be wrong — the interval above does not fire while the app is suspended,
  // so without this a rider who pockets the phone for ten minutes reappears at
  // the place they pocketed it.
  useEffect(() => {
    if (!active) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reportOnce();
    });
    return () => subscription.remove();
  }, [active, reportOnce]);

  return { status, lastReportedAt, reportNow: reportOnce };
}

/** What the rider should be told, or null when there is nothing to say. */
export function locationMessage(status) {
  switch (status) {
    case 'denied':
      return 'Location is switched off for RoadMate Rider. Orders are given to the rider nearest the shop, so you will not be offered any until you allow it in your phone settings.';
    case 'unavailable':
      return 'Your phone’s location services are off. Turn them on — orders are assigned by how close you are.';
    default:
      return null;
  }
}
