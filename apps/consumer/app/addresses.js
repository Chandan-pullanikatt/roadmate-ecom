// The address book — and the pin.
//
// **Coordinates are the address; the text is for the human at the door.**
// Serviceability, shop ranking, the ETA and the rider's navigation all read
// `latitude`/`longitude`, and the rider app deliberately navigates by
// coordinates rather than by the typed street, because a text search lands a
// rider on a similarly-named road across the city (HANDOFF §6, Phase 3). So the
// server refuses an address without a valid lat/lng, and this screen will not
// let one be saved without a fix.
//
// **There IS a map, as of 2026-08-19, and the reason is the one thing text can
// never do.** This file used to say a map was a decision rather than a gap, on
// the grounds that nobody had bought a Google Maps key. That held while the only
// pin came from the device's own GPS — a metre-accurate reading of where the
// customer is standing needs no confirming. It stopped holding the moment search
// arrived: a *searched* address lands on a locality centroid or a street, tens
// to hundreds of metres from the door, and there was no way for the customer to
// say "no, it's the next building". Every quick-commerce app in India — Swiggy,
// Blinkit, Zepto, Instamart — runs the same three steps for exactly this reason:
//
//     type-ahead search  →  CONFIRM THE PIN ON A MAP  →  flat/floor/landmark
//
// The middle step is not decoration. Without it the second step's error lands on
// a rider standing in the wrong street, and the only correction mechanism this
// screen had was hoping somebody typed a good landmark.
//
// ── TWO WAYS TO GET A PIN, AND WHY THE SECOND ONE HAD TO EXIST ───────────────
//
// This screen used to offer only the device's own GPS fix. That is the best
// possible pin for somebody standing at the door they want delivered to — and it
// makes a whole category of order **impossible**: sending something to a friend
// across town, to a parent's house, to an office you are not currently sitting
// in. You cannot save an address you are not standing at, so you cannot order to
// one. That is not a demo inconvenience, it is a missing feature, and every
// delivery app in India solves it.
//
// So there are now two:
//
//   1. **Use my current location** — `getCurrentPositionAsync`. Metre-accurate,
//      and correct for your own door.
//   2. **Search for an address** — type-ahead against Google Places, proxied
//      through our own server (`GET /api/geo/places/search`). Type where it is
//      going, pick from suggestions, get coordinates back.
//
//      ⚠️ **Through the server, never straight to Google.** A Places key inside
//      an APK is extractable with `unzip` and bills to our card. The server
//      holds that key; the app holds only the *Maps SDK* key, which has to be on
//      the device and is defended by package + signing-certificate restriction
//      instead. `server/src/lib/places.js` and `app.config.js` are the two ends
//      of that split.
//
//      If the server has no key configured it answers 503, and this screen falls
//      back to the platform's own `Location.geocodeAsync` — worse, but working.
//      A demo should not go dark because a key is not provisioned yet.
//
// Two properties of the search worth knowing, both surfaced on screen rather
// than papered over:
//
//   • **A searched pin is coarser than a GPS one.** It lands on a locality or a
//     street, not on a doorway — which is what the map is for: pan it so the pin
//     sits on the actual door. The screen says which method produced the pin, and
//     the landmark field is still where "third floor, blue gate" goes, because no
//     coordinate tells a rider which bell to press.
//   • **It needs no location permission at all**, because it looks up an address
//     rather than reading the device. A customer who has refused location can
//     now still save an address and order, which the GPS-only version made
//     flatly impossible.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import MapView from 'react-native-maps';
import * as Location from 'expo-location';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  GroupedCard,
  GroupedRow,
  SectionHeader,
  EmptyState,
  Banner,
  Button,
  StatusPill
} from '@roadmate/ui';
import { newPlacesSession } from '@roadmate/api';
import { useApi } from '../src/session.js';
import { usePlacesSearch } from '../src/placesSearch.js';
import { usePlace } from '../src/place.js';
import { formatAddress } from '../src/order.js';

/**
 * Was a Maps SDK key baked into this build?
 *
 * `EXPO_PUBLIC_*` is inlined by Expo at bundle time, so this is a constant by
 * the time it reaches a phone — not a runtime lookup.
 *
 * ⚠️ This gates whether the map is *rendered at all*, and that is the point. An
 * unkeyed `MapView` does not fail loudly: it draws a grey grid and writes an
 * authorization error to logcat, which reads to a customer — and to a client
 * watching a demo — as a broken app rather than an unconfigured one. Absent is
 * honest; broken is not. Search still works either way, so the screen loses its
 * confirm step and keeps everything else.
 */
const HAS_MAPS_KEY = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY);

export default function Addresses() {
  const api = useApi();
  const { addresses, addressId, setAddressId, refreshAddresses } = usePlace();

  const [adding, setAdding] = useState(false);

  const remove = (address) =>
    Alert.alert('Remove this address?', formatAddress(address), [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteAddress(address.id);
            if (address.id === addressId) setAddressId(null);
            await refreshAddresses();
          } catch (err) {
            // 409: an order used it. The row has to stay or that order loses
            // where it went.
            Alert.alert(
              'Kept',
              err.status === 409
                ? 'An order was delivered here, so this address stays on the record. You can stop using it — just pick another one.'
                : err.message
            );
          }
        }
      }
    ]);

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <SectionHeader title="Saved addresses" />

      {addresses.length === 0 ? (
        <Card>
          <EmptyState
            title="No addresses yet"
            message="Everything RoadMate shows you depends on where the order is going, so this is the first thing to add."
          />
        </Card>
      ) : (
        <GroupedCard>
          {addresses.map((a) => (
            <GroupedRow
              key={a.id}
              label={a.label}
              sublabel={formatAddress(a)}
              right={
                a.id === addressId ? (
                  <StatusPill tone="success" label="Delivering here" />
                ) : (
                  <Text style={styles.use}>Use</Text>
                )
              }
              onPress={() => setAddressId(a.id)}
            />
          ))}
        </GroupedCard>
      )}

      {/* Removal is its own row rather than a swipe: a swipe that deletes an
          address is a gesture people discover by accident, and an address that
          an order used cannot be deleted at all (409) — better to say that in a
          dialog than to animate a row away and put it back. */}
      {addresses.map((a) => (
        <Button key={`rm-${a.id}`} label={`Remove ${a.label}`} variant="ghost" onPress={() => remove(a)} />
      ))}

      {adding ? (
        <NewAddress
          onCancel={() => setAdding(false)}
          onSaved={async (address) => {
            setAdding(false);
            await refreshAddresses();
            setAddressId(address.id);
          }}
        />
      ) : (
        <Button label="Add an address" onPress={() => setAdding(true)} />
      )}
    </ScrollView>
  );
}

/** The form. Nothing is saved until there is a fix to save it against. */
function NewAddress({ onCancel, onSaved }) {
  const api = useApi();
  const { locateDevice, deviceFix, locationState } = usePlace();

  const [fix, setFix] = useState(deviceFix ?? null);
  const [accuracy, setAccuracy] = useState(null);
  /**
   * 'device' | 'search' | 'map' — which method produced `fix`. Shown, never
   * guessed, because the three carry genuinely different accuracy and the
   * banner tells the customer which one they are trusting.
   */
  const [fixSource, setFixSource] = useState(deviceFix ? 'device' : null);
  const [fields, setFields] = useState({
    label: 'Home',
    line1: '',
    line2: '',
    landmark: '',
    city: '',
    pincode: ''
  });
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /** Resolving a chosen suggestion into coordinates — a second round trip. */
  const [resolving, setResolving] = useState(false);
  /** The map has finished its opening animation; see `onRegionSettled`. */
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef(null);

  // The address search, with its debounce, its request race and its fallback.
  // See `src/placesSearch.js` — it is a state machine, not a field.
  const search = usePlacesSearch(api, deviceFix ?? fix);

  const set = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));

  const dropPin = useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is off, so we cannot drop a pin. Turn it on in Settings and try again.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      setFix(next);
      setAccuracy(position.coords.accuracy ?? null);
      setFixSource('device');
      search.clear();
      // Also refresh the shared fix, so the home screen has something to work
      // with even if this form is abandoned.
      locateDevice();

      // Reverse geocoding is best-effort: it uses the platform's own geocoder,
      // needs no key, and is allowed to fail. It prefills the text; the customer
      // is the authority on their own address and every field stays editable.
      try {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: next.lat,
          longitude: next.lng
        });
        if (place) {
          setFields((f) => ({
            ...f,
            line1: f.line1 || [place.streetNumber, place.street ?? place.name].filter(Boolean).join(' '),
            line2: f.line2 || place.district || '',
            city: f.city || place.city || place.subregion || '',
            pincode: f.pincode || place.postalCode || ''
          }));
        }
      } catch {
        /* no geocoder on this device — the fields stay as typed */
      }
    } catch {
      setError('Could not get a location fix. Move somewhere with a clearer sky, or try again.');
    } finally {
      setLocating(false);
    }
  }, [locateDevice]);

  /**
   * Take one suggestion as the pin, and prefill the text from it.
   *
   * The typed fields are only ever filled when *empty* (`f.line1 || ...`): a
   * customer who has already typed their flat number must not have it replaced
   * by whatever Google thinks the building is called.
   */
  const chooseResult = async (hit) => {
    setResolving(true);
    setError(null);
    try {
      const place = await search.resolve(hit);
      if (!place) {
        setError('That address has no location on it. Pick another, or use your current location.');
        return;
      }
      setFix({ lat: place.latitude, lng: place.longitude });
      // A searched pin has no accuracy figure — it is a locality, not a reading.
      // Null rather than a number, for the same reason the ETA is null and not 0
      // for a membership: "unknown" and "excellent" are different claims.
      setAccuracy(null);
      setFixSource('search');
      search.clear();
      setFields((f) => ({
        ...f,
        line1: f.line1 || place.line1 || '',
        line2: f.line2 || place.line2 || '',
        city: f.city || place.city || '',
        pincode: f.pincode || place.pincode || ''
      }));
    } catch {
      setError('Could not look that address up. Try another, or use your current location.');
    } finally {
      setResolving(false);
    }
  };

  /**
   * The map settled somewhere new — the customer panned the pin onto their door.
   *
   * ⚠️ Guarded by `mapReady`. `onRegionChangeComplete` fires once on mount as the
   * map animates to its initial region, and without the guard that first frame
   * would count as a drag: `fixSource` would flip to 'map' and the reverse
   * geocode would fire before the customer has touched anything, on every open.
   *
   * The reverse geocode is best-effort and deliberately does NOT block saving.
   * The coordinates are the address (see the top of this file); the words are
   * for the human at the door, and the customer can type them.
   */
  const onRegionSettled = useCallback(
    async (region) => {
      if (!mapReady) return;
      const next = { lat: region.latitude, lng: region.longitude };
      // Sub-10-metre settles are the map easing to a stop, not a customer
      // choosing a different door. Reverse geocoding those would burn a paid
      // call per animation frame.
      if (fix && Math.abs(fix.lat - next.lat) < 1e-4 && Math.abs(fix.lng - next.lng) < 1e-4) return;

      setFix(next);
      setAccuracy(null);
      setFixSource('map');

      try {
        const res = await api.reverseGeocode(next.lat, next.lng);
        const place = res?.place;
        if (place) {
          setFields((f) => ({
            ...f,
            line1: f.line1 || place.line1 || '',
            line2: f.line2 || place.line2 || '',
            city: f.city || place.city || '',
            pincode: f.pincode || place.pincode || ''
          }));
        }
      } catch {
        /* no words for this spot — the coordinates are still perfectly saveable */
      }
    },
    [api, fix, mapReady]
  );


  /**
   * Move the map when something *other than the map* moved the pin.
   *
   * `initialRegion` is honoured once, at mount. Without this, choosing a search
   * result or re-dropping the GPS pin updates `fix` and leaves the map showing
   * the old place — the customer sees a pin sitting on the wrong building and
   * has no way to know which one is about to be saved.
   *
   * Skipped for `fixSource === 'map'`, or panning the map would fight the
   * customer's own thumb by animating back to where it just was.
   */
  useEffect(() => {
    if (!fix || !mapReady || fixSource === 'map') return;
    mapRef.current?.animateToRegion(
      {
        latitude: fix.lat,
        longitude: fix.lng,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005
      },
      350
    );
  }, [fix, fixSource, mapReady]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createAddress({
        ...fields,
        latitude: fix.lat,
        longitude: fix.lng
      });
      onSaved(result.address);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.form}>
      <SectionHeader title="New address" />

      {/* Where is this going? Two answers, and the second is the one that makes
          ordering to somebody else's address possible at all. */}
      <Text style={typography.meta}>Where is this order going?</Text>

      <Button
        label={fixSource === 'device' ? 'Use my current location again' : 'I am at this address now'}
        variant={fixSource === 'device' ? 'secondary' : 'primary'}
        onPress={dropPin}
        loading={locating}
      />

      <View style={styles.searchBlock}>
        <Text style={typography.meta}>Or search for it — for anywhere you are not right now</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.searchInput]}
            value={search.query}
            onChangeText={search.setQuery}
            placeholder="Kakkanad, Kochi"
            placeholderTextColor={colors.inkFaint}
            autoCorrect={false}
            returnKeyType="search"
          />
          {/* No Search button: results arrive as you type. The spinner sits
              where the button was so the row does not reflow mid-keystroke. */}
          {search.searching || resolving ? (
            <ActivityIndicator color={colors.info} style={styles.searchSpinner} />
          ) : null}
        </View>

        {search.results?.length ? (
          <GroupedCard>
            {search.results.map((hit, i) => (
              <GroupedRow
                key={hit.placeId ?? `${hit.coords?.lat},${hit.coords?.lng},${i}`}
                label={hit.title}
                sublabel={hit.subtitle || undefined}
                onPress={() => chooseResult(hit)}
              />
            ))}
          </GroupedCard>
        ) : null}

        {search.error ? <Banner tone="warning" message={search.error} /> : null}
      </View>

      {/* THE CONFIRM STEP. Only once there is something to confirm — an empty
          map centred on nothing asks the customer to find their own house in
          the Bay of Bengal. */}
      {fix && HAS_MAPS_KEY ? (
        <View style={styles.mapOuter}>
          {/* Clipping wrapper holds the MapView and NOTHING else. A rounded
              View with overflow:hidden eats emoji and text children on Android,
              so the pin below is a sibling rather than a child. */}
          <View style={styles.mapClip}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={{
                latitude: fix.lat,
                longitude: fix.lng,
                // ~600 m across: close enough to tell two buildings apart, which
                // is the whole job. Wider and the pin cannot be placed precisely.
                latitudeDelta: 0.005,
                longitudeDelta: 0.005
              }}
              onMapReady={() => setMapReady(true)}
              onRegionChangeComplete={onRegionSettled}
              showsUserLocation={locationState === 'granted'}
              showsMyLocationButton={false}
              toolbarEnabled={false}
            />
          </View>
          {/* The pin does not move — the map moves under it. Every Indian
              delivery app does it this way, because a draggable marker is a
              44-pixel target under the customer's own thumb. */}
          <View style={styles.pinOverlay} pointerEvents="none">
            <Text style={styles.pinGlyph}>📍</Text>
          </View>
        </View>
      ) : null}

      {/* What the pin is worth, in words. The map above shows *where* it is; this
          says how much to trust it, which is a different question and the one
          that decides whether the customer should bother adjusting it. */}
      {fix ? (
        <Banner
          tone={fixSource === 'search' || (accuracy && accuracy > 100) ? 'warning' : 'info'}
          message={
            fixSource === 'search'
              ? HAS_MAPS_KEY
                ? 'Found it — but a searched address lands on the street, not the doorway. Drag the map so the pin sits on your building, then add the flat or gate below.'
                : 'Found it. A searched address lands on the street rather than the doorway, so put the flat, floor or gate in the landmark box below — that is what your delivery partner reads at the door.'
              : fixSource === 'map'
                ? 'Pin moved. That is now the exact spot your delivery partner is sent to.'
                : accuracy
                  ? `Pin dropped, accurate to about ${Math.round(accuracy)} m.${
                      accuracy > 100 ? (HAS_MAPS_KEY ? ' That is rough — drag the map to put the pin on your door.' : ' That is rough — stand outside the door and drop it again if you can.') : ''
                    }`
                  : 'Pin dropped.'
          }
        />
      ) : (
        <Text style={typography.meta}>
          {locationState === 'denied'
            ? // No longer a dead end: search needs no permission, because it asks
              // about an address rather than reading the device.
              'Location is switched off for RoadMate, so "I am at this address now" will not work — but the search above does not need it.'
            : 'An address needs coordinates before it can be saved — that is what routes your order and gets the rider to the right door.'}
        </Text>
      )}

      <Field label="Name it" value={fields.label} onChangeText={set('label')} placeholder="Home, Work…" />
      <Field
        label="Flat, building, street"
        value={fields.line1}
        onChangeText={set('line1')}
        placeholder="12, Sanjay Nagar Main Road"
      />
      <Field label="Area" value={fields.line2} onChangeText={set('line2')} placeholder="Optional" />
      <Field
        label="Landmark"
        value={fields.landmark}
        onChangeText={set('landmark')}
        // Optional for a GPS pin at your own door; the thing that makes a
        // searched address deliverable. The label says which.
        placeholder={fixSource === 'search' ? 'Flat, floor, gate — the rider reads this' : 'Optional'}
      />
      <Field label="City" value={fields.city} onChangeText={set('city')} placeholder="Bengaluru" />
      <Field
        label="PIN code"
        value={fields.pincode}
        onChangeText={set('pincode')}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="560094"
      />

      {error ? <Banner tone="danger" message={error} /> : null}

      <Button
        label="Save address"
        onPress={save}
        loading={busy}
        disabled={!fix || !fields.line1.trim()}
      />
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={typography.meta}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.inkFaint}
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  use: { ...typography.meta, fontWeight: '700', color: colors.info },
  form: { gap: spacing.md },
  field: { gap: spacing.xs },
  searchBlock: { gap: spacing.xs },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  searchInput: { flex: 1 },
  searchSpinner: { width: 24 },
  // ⚠️ THREE LAYOUT RULES HERE, EACH LOAD-BEARING.
  //
  // 1. `map` is `flex: 1` inside a fixed-height parent, NOT `absoluteFill`.
  //    react-native-maps draws nothing at all when it cannot measure a concrete
  //    size at mount, and a MapView absolutely filling an absolutely-filled
  //    parent is exactly that case — the symptom is a blank white box with
  //    whatever you overlaid still visible on top of it, which reads as a
  //    broken map rather than an unmeasured one. Give it a real box.
  //
  // 2. `mapOuter` is NOT clipped. It holds the pin, and a rounded
  //    overflow-hidden View eats emoji children on Android.
  //
  // 3. `mapClip` therefore does the rounding, and holds the MapView alone.
  mapOuter: { height: 220, position: 'relative' },
  mapClip: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.page
  },
  map: { flex: 1 },
  pinOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Nudged up by half a glyph so the point of the pin, not its middle, sits
    // on the centre of the map — which is the coordinate actually being saved.
    paddingBottom: 24
  },
  pinGlyph: { fontSize: 32 },
  input: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 46,
    fontSize: 15,
    color: colors.ink
  }
});
