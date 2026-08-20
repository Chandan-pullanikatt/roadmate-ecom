// Address type-ahead, and the fallback for when it is not available.
//
// Split out of `app/addresses.js` because it is a *state machine* — debounce,
// in-flight request, a race between two keystrokes, a provider that may not be
// configured — and inlining that made the screen impossible to read next to the
// form it belongs to.
//
// ── THE RACE, WHICH IS THE ONLY SUBTLE PART ─────────────────────────────────
//
// A customer types "kakk" then "kakka". Two requests are now in flight, and the
// network is under no obligation to answer them in order. If "kakk"'s answer
// lands second it overwrites the better one, and the list visibly reverts to
// staler suggestions while the customer is still reading it.
//
// Every request is therefore stamped with a sequence number and the answer is
// dropped unless it is the newest one asked for. This is cheaper and steadier
// than aborting the previous request, and it means a slow reply is *ignored*
// rather than cancelled — the session it belongs to is still billed either way.
//
// ── FALLBACK ────────────────────────────────────────────────────────────────
//
// A 503 from the server means no Places key is configured there. Rather than
// dead-ending the customer, this falls back to `expo-location`'s on-device
// geocoder — the implementation this screen used before Places existed. It is
// worse: no type-ahead, poorer on Indian addresses, and absent entirely on
// phones without Play Services. But "worse" beats "no address search", and it
// keeps a demo alive through a missing environment variable.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { newPlacesSession } from '@roadmate/api';

/** How long a customer stops typing before it counts as a query. */
const DEBOUNCE_MS = 300;

/** Below this, suggestions are noise — and Google charges for noise. */
const MIN_CHARS = 3;

/**
 * @param {object} api        the customer API client
 * @param {{lat:number,lng:number}|null} bias  bias results near here, if known
 * @returns {{
 *   query: string, setQuery: (s:string)=>void,
 *   results: Array|null, searching: boolean, error: string|null,
 *   mode: 'places'|'device',
 *   resolve: (hit:object)=>Promise<object|null>,
 *   clear: ()=>void
 * }}
 */
export function usePlacesSearch(api, bias) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  /** 'places' until the server tells us it has no key, then 'device' forever. */
  const [mode, setMode] = useState('places');

  // One session token per address entry — a billing boundary, see
  // `newPlacesSession`. Re-minted after each resolve, because a session ends at
  // its details call and reusing a spent one bills the next run per request.
  const session = useRef(newPlacesSession());
  const seq = useRef(0);
  const timer = useRef(null);

  /** The on-device geocoder, shaped like a Places suggestion list. */
  const deviceSearch = useCallback(async (q) => {
    const hits = await Location.geocodeAsync(q);
    return Promise.all(
      hits.slice(0, 5).map(async (hit) => {
        try {
          const [place] = await Location.reverseGeocodeAsync({
            latitude: hit.latitude,
            longitude: hit.longitude
          });
          const parts = [
            place?.name,
            place?.street,
            place?.district,
            place?.city ?? place?.subregion,
            place?.postalCode
          ].filter(Boolean);
          const seen = new Set();
          const title = parts.filter((x) => !seen.has(x) && seen.add(x)).join(', ');
          return {
            // No placeId: `resolve` reads that to tell the two sources apart.
            title: title || q,
            subtitle: '',
            coords: { lat: hit.latitude, lng: hit.longitude },
            place: place ?? null
          };
        } catch {
          return { title: q, subtitle: '', coords: { lat: hit.latitude, lng: hit.longitude }, place: null };
        }
      })
    );
  }, []);

  useEffect(() => {
    const q = query.trim();

    if (timer.current) clearTimeout(timer.current);

    if (q.length < MIN_CHARS) {
      // Not an error state. The customer is mid-word, and red text under a box
      // somebody is still typing into is nagging, not help.
      setResults(null);
      setSearching(false);
      setError(null);
      return undefined;
    }

    setSearching(true);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      try {
        let list;
        if (mode === 'places') {
          const res = await api.searchPlaces({
            q,
            session: session.current,
            ...(bias ? { lat: bias.lat, lng: bias.lng } : {})
          });
          list = (res.results || []).map((r) => ({ ...r, coords: null, place: null }));
        } else {
          list = await deviceSearch(q);
        }
        if (mine !== seq.current) return; // a newer keystroke already won
        setResults(list);
        setError(list.length ? null : 'Nothing found for that. Try a nearby landmark, or the locality and city.');
      } catch (err) {
        if (mine !== seq.current) return;
        if (err?.status === 503 && mode === 'places') {
          // No key on the server. Switch permanently and retry through the
          // device — the effect re-runs on `mode`, so this is one line, not a
          // recursive call.
          setMode('device');
          return;
        }
        setResults(null);
        setError(
          err?.status === 0
            ? 'No connection, so we cannot search for an address right now.'
            : 'Address search is not available right now. You can still use your current location.'
        );
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => timer.current && clearTimeout(timer.current);
  }, [query, mode, api, bias?.lat, bias?.lng, deviceSearch]);

  /**
   * Turn a chosen suggestion into coordinates and address text.
   *
   * A Places suggestion carries only a `placeId` and needs a second call — the
   * one that closes the billing session. A device hit already has coordinates,
   * so it resolves locally with no round trip.
   */
  const resolve = useCallback(
    async (hit) => {
      if (!hit.placeId) {
        // Device hit: already resolved, just reshape.
        return {
          latitude: hit.coords.lat,
          longitude: hit.coords.lng,
          line1: [hit.place?.streetNumber, hit.place?.street ?? hit.place?.name].filter(Boolean).join(' '),
          line2: hit.place?.district || '',
          city: hit.place?.city || hit.place?.subregion || '',
          pincode: hit.place?.postalCode || ''
        };
      }
      try {
        const res = await api.placeDetails({ placeId: hit.placeId, session: session.current });
        return res.place ?? null;
      } finally {
        // The session ended with that details call, spent either way.
        session.current = newPlacesSession();
      }
    },
    [api]
  );

  const clear = useCallback(() => {
    seq.current += 1; // orphan anything in flight
    setQuery('');
    setResults(null);
    setError(null);
    setSearching(false);
  }, []);

  return { query, setQuery, results, searching, error, mode, resolve, clear };
}
