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
// **There is no draggable map, and that is a decision rather than a gap.** One
// needs `react-native-maps` and a Google Maps key nobody has bought, and the
// rest of the platform already hands off to Google Maps instead of embedding
// one. What this does instead is honest about its accuracy: the device's own
// fix is the pin, reverse geocoding pre-fills the text so nobody types their
// own street name, and the text stays editable. A customer standing at the door
// they want delivered to gets a better pin from this than from dragging a map
// at arm's length; a customer saving their office from home gets a wrong one
// either way, which is why the fix's accuracy is shown rather than hidden.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert, StyleSheet } from 'react-native';
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
import { useApi } from '../src/session.js';
import { usePlace } from '../src/place.js';
import { formatAddress } from '../src/order.js';

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

      <Button
        label={fix ? 'Drop the pin again' : 'Drop a pin where I am'}
        variant={fix ? 'secondary' : 'primary'}
        onPress={dropPin}
        loading={locating}
      />

      {fix ? (
        <Banner
          tone={accuracy && accuracy > 100 ? 'warning' : 'info'}
          message={
            accuracy
              ? `Pin dropped, accurate to about ${Math.round(accuracy)} m.${
                  accuracy > 100 ? ' That is rough — stand outside the door and drop it again if you can.' : ''
                }`
              : 'Pin dropped.'
          }
        />
      ) : (
        <Text style={typography.meta}>
          {locationState === 'denied'
            ? 'Location is switched off for RoadMate. An address cannot be routed without coordinates, so it has to be turned on to save one.'
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
      <Field label="Landmark" value={fields.landmark} onChangeText={set('landmark')} placeholder="Optional" />
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
