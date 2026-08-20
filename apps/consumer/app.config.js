// One job: put the Google Maps SDK key into the Android config at build time.
//
// WHY THIS FILE EXISTS AT ALL, given app.json is meant to be the whole
// configuration for this app (and says so).
//
// `app.json` is static JSON. Expo does not expand environment variables in it,
// so `"apiKey": "$EXPO_PUBLIC_GOOGLE_MAPS_KEY"` would ship those literal
// characters to the phone and the map would render as a grey grid with a
// "Authorization failure" line in logcat — a failure that looks like a broken
// map rather than like a missing key. `app.config.js` is a *function*, runs at
// build time, and can read `process.env`. That is the only reason it is here.
//
// It spreads `app.json` rather than replacing it: everything else — the icons,
// the permissions, the blocked RECORD_AUDIO, the plugins — stays exactly where
// it was, and this file must never grow a second responsibility.
//
// ── THE TWO KEYS, WHICH ARE NOT INTERCHANGEABLE ─────────────────────────────
//
// This one ships inside the APK, unavoidably: the map renderer needs it on the
// device. Anybody can `unzip` an APK and read it. It is therefore defended by
// *restriction* rather than by secrecy — in Google Cloud, set it to:
//
//   Application restriction : Android apps
//                             com.roadmate.customer + the SHA-1 of the
//                             certificate EAS signs with
//                             (`eas credentials` prints it)
//   API restriction         : Maps SDK for Android — and nothing else
//
// So restricted, an extracted key is useless to anyone who cannot sign as us.
//
// ⚠️ **Never enable Places or Geocoding on this key.** Those are billed per
// call, and a per-call API on a key that cannot be kept secret is somebody
// else's shopping spree on your card. They belong to the *server's*
// `GOOGLE_MAPS_API_KEY`, a separate key restricted by IP, which is the entire
// reason `server/src/lib/places.js` exists as a proxy.
//
// ── SUPPLYING IT ────────────────────────────────────────────────────────────
//
// Not committed, so builds read it from the environment:
//
//   eas secret:create --scope project \
//     --name EXPO_PUBLIC_GOOGLE_MAPS_KEY --value AIza...
//
// and locally, in `apps/consumer/.env`, for `npx expo run:android`.
//
// Missing, the app still builds and every non-map screen works — the map is the
// only thing that degrades. That is on purpose: a missing key should not be able
// to break a build that ninety percent of the app does not need it for.
import appJson from './app.json' with { type: 'json' };

export default ({ config }) => {
  const base = { ...appJson.expo, ...config };
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;

  if (!apiKey && process.env.EAS_BUILD) {
    // Loud in CI, where nobody is watching the screen, and where the alternative
    // is discovering it on a phone after a twenty-minute build.
    console.warn(
      '[app.config] EXPO_PUBLIC_GOOGLE_MAPS_KEY is not set — the address map will render blank. ' +
        'Set it with `eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_KEY`.'
    );
  }

  return {
    ...base,
    android: {
      ...base.android,
      // Only written when we actually have one. An empty string is worse than
      // an absent key: the native module treats it as a real value and fails
      // authorization rather than falling back.
      ...(apiKey ? { config: { ...base.android?.config, googleMaps: { apiKey } } } : {})
    }
  };
};
