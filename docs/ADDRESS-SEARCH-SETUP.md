# Address search and the map pin — setup

Everything the address picker needs, and why it is two keys rather than one.

---

## Why two keys

They have opposite threat models, and mixing them is the expensive mistake.

| | **Server key** | **App key** |
|---|---|---|
| Lives in | `GOOGLE_MAPS_API_KEY` on the API | Inside the APK, unavoidably |
| APIs enabled | Places API (New), Geocoding API | Maps SDK for Android — nothing else |
| Restricted by | IP address | Package name + signing SHA-1 |
| Billed | Per call | Per map load |

Places and Geocoding bill **per call**. Any key inside an APK can be pulled out
with `unzip` and a text editor, and it bills to your card until somebody
notices. So those two APIs never go on a key that ships.

The Maps SDK key has no choice — the renderer needs it on the device. It is
defended by *restriction* instead: locked to `com.roadmate.customer` plus the
SHA-1 of the certificate EAS signs with, an extracted copy is useless to anyone
who cannot sign as you.

That split is the whole reason the app calls `/api/geo/places/*` on our own
server instead of calling Google directly.

---

## 1. Google Cloud

One project, billing enabled (Google requires a card even inside the free
tier). Enable three APIs:

- **Places API (New)** — the type-ahead
- **Geocoding API** — coordinates back to an address after the pin moves
- **Maps SDK for Android** — the map itself

Then create **two** keys under *Credentials*.

**Key A — server.** Application restriction: *IP addresses*, set to your API
host's outbound IPs (Render lists these under the service's Connect tab). API
restriction: Places API (New) + Geocoding API.

**Key B — app.** Application restriction: *Android apps*, package name
`com.roadmate.customer`, SHA-1 from:

```
cd apps/consumer && eas credentials
```

API restriction: **Maps SDK for Android only.**

> If you use a debug build or a local `expo run:android`, that uses a *different*
> signing certificate. Add its SHA-1 too, or the map renders grey on the debug
> build while working perfectly in the EAS one.

---

## 2. The server

Local — in `server/.env`:

```
GOOGLE_MAPS_API_KEY="<key A>"
```

On Render, add the same name and value under the service's Environment tab.
The service restarts itself.

Verify:

```
curl "https://<your-api>/api/geo/places/search?q=kakkanad" \
  -H "Authorization: Bearer <a customer token>"
```

`503 unconfigured` means the key is not set. `200` with a `results` array means
it works.

---

## 3. The app

`app.config.js` reads `EXPO_PUBLIC_GOOGLE_MAPS_KEY` at build time. `.env` files
are gitignored and EAS only uploads what git tracks, so setting it locally is
**not** enough for a build — the same trap as the Razorpay key:

```
cd apps/consumer
eas env:create --name EXPO_PUBLIC_GOOGLE_MAPS_KEY \
  --value "<key B>" --visibility plaintext \
  --environment development --environment preview
```

`plaintext` is correct: this key ships inside every APK by design.

For local Metro, put it in `apps/consumer/.env` and restart with
`npx expo start --clear` — Metro caches the transform, so a plain reload will
not pick it up.

Confirm it reached the config:

```
npx expo config --type prebuild --json | grep -A3 googleMaps
```

`--type public` deliberately strips `android.config`, so check `prebuild`.

---

## 4. Rebuild

`react-native-maps` is a native module, so this needs a real build — a JS reload
cannot deliver it:

```
cd apps/consumer && eas build -p android --profile preview
```

Everyone testing needs the new APK. An older install will keep running its own
embedded bundle and show the old screen.

---

## What happens when it is not set up

Deliberately degraded rather than broken, so a missing key never dark-screens a
demo:

| Missing | Effect |
|---|---|
| Server key | `/api/geo/places/*` answer 503; the app falls back to the phone's own geocoder — no type-ahead, worse on Indian addresses, absent on phones without Play Services |
| App key | Everything works except the map area, which renders blank |
| Both | Exactly the behaviour before this feature — GPS pin plus device geocoder |

---

## Cost

Billed per autocomplete **session**, not per keystroke — but only if the session
token is passed through. The app mints one per address entry and passes it to
both the search and the details call (`newPlacesSession`). Drop it and the same
typing bills per request instead, several times the price.

Google's free monthly credit covers demo and early-launch volume comfortably.
Set a budget alert anyway. If Places becomes a real line item later, the
provider is isolated behind `server/src/lib/places.js` — everything
Google-specific is under one `--- google ---` heading, and Mappls or Ola Maps is
a rewrite of that section rather than of the app.
