// "Manage Slots" — the venue's calendar (SERVICE_BOOKING, `designs/Partner.png`).
//
// For a turf, this screen is the Stock screen. A grocer's shelf is a number it
// keeps honest; a turf's shelf is a list of hours it opens for sale, and until
// one is opened here there is nothing for a customer to buy. That is the frame
// the whole screen is built on, and why the empty state says so rather than
// shrugging.
//
// THE THREE DECISIONS THIS SCREEN MAKES VISIBLE:
//
//   1. **A venue opens a day, not an hour.** Nobody taps out seventeen identical
//      rows, so the form takes "6am to 11pm, hour slots" and the server cuts it
//      up. Re-running the same day is a skip, not a duplicate, so adding one
//      more evening hour is safe — the result banner says how many were new.
//   2. **Close and delete are different verbs, and the screen never confuses
//      them.** An hour somebody has booked cannot be deleted (409
//      `SLOT_HAS_BOOKINGS`); their voucher's entire meaning is the window it
//      names. So a booked row offers Close and no delete at all, rather than
//      offering one that fails.
//   3. **"2 of 4 left" is the number that matters**, not `booked`. A venue
//      standing at its own gate is asking "can I still sell this hour", and
//      capacity minus bookings is that answer.
//
// ⚠️ **Times are typed, not picked.** A wheel picker means
// `@react-native-community/datetimepicker`, which is a native module, and a new
// native module crashes every installed dev client across three codebases
// (HANDOFF §6). Same call as the Rider app handing off to Google Maps. The
// fields are pre-filled with a sensible day and validated before they are sent,
// which is the honest version of this trade.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Alert, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Button,
  Banner,
  Divider,
  SectionHeader,
  StatusPill,
  EmptyState,
  SkeletonCard,
  connectionMessage,
  formatINR
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi, useSession } from '../../src/session.js';

/** `2026-08-20` in the device's own timezone — not `toISOString`, which is UTC. */
const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A typed date and time into a real Date, in the device's timezone.
 *
 * Built field by field rather than parsed from a string: `new Date('2026-08-20
 * 18:00')` is implementation-defined and has historically meant UTC on some
 * engines and local time on others. A venue that opens at 6pm and gets 11:30pm
 * would have no way of knowing why.
 */
function atLocalTime(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const out = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayOf = (iso) =>
  new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

export default function Slots() {
  const api = useApi();
  const { user } = useSession();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);

  const slots = useResource(useCallback(() => api.listSlots(), [api]));
  const products = useResource(useCallback(() => api.listInventory(), [api]));

  const rows = slots.data?.slots ?? [];
  const problem = connectionMessage(slots.error);

  // Grouped by day, because a flat list of 60 hours is unreadable and a venue
  // thinks in days ("is Saturday open yet?").
  const days = useMemo(() => {
    const map = new Map();
    for (const slot of rows) {
      const key = dayOf(slot.startsAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(slot);
    }
    return [...map.entries()];
  }, [rows]);

  const isBookingVenue = user?.industry?.fulfilmentType === 'SERVICE_BOOKING';

  const close = async (slot, isOpen) => {
    try {
      await api.updateSlot(slot.id, { isOpen });
      slots.reload();
    } catch (err) {
      Alert.alert('Not changed', err.message);
    }
  };

  const remove = (slot) =>
    Alert.alert('Remove this hour?', `${dayOf(slot.startsAt)}, ${timeOf(slot.startsAt)}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteSlot(slot.id);
            slots.reload();
          } catch (err) {
            // 409 — somebody booked it between the screen rendering and the tap.
            Alert.alert(
              'Kept',
              err.status === 409
                ? 'Somebody has booked this hour, so it stays on the record. Close it instead to stop selling it.'
                : err.message
            );
          }
        }
      }
    ]);

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      {problem ? <Banner message={problem} action="Retry" onAction={slots.reload} /> : null}
      {notice ? <Banner tone="success" message={notice} /> : null}

      {!isBookingVenue ? (
        <Banner
          message="This venue does not sell time slots, so nothing here applies to it. Your shelf is under Stock."
        />
      ) : null}

      {adding ? (
        <OpenHours
          api={api}
          products={products.data?.items ?? []}
          onCancel={() => setAdding(false)}
          onOpened={(result) => {
            setAdding(false);
            setNotice(
              result.skipped > 0
                ? `${result.created} new hour${result.created === 1 ? '' : 's'} opened. ${result.skipped} ${
                    result.skipped === 1 ? 'was' : 'were'
                  } already on the calendar.`
                : `${result.created} hour${result.created === 1 ? '' : 's'} opened.`
            );
            slots.reload();
          }}
        />
      ) : (
        <Button label="Open hours for sale" onPress={() => setAdding(true)} />
      )}

      {slots.loading && !slots.data ? (
        <SkeletonCard count={3} />
      ) : days.length === 0 ? (
        <Card>
          <EmptyState
            title="No hours on the calendar"
            message="A slot is your shelf: until an hour is open here, there is nothing for a customer to book."
          />
        </Card>
      ) : (
        days.map(([day, daySlots]) => (
          <View key={day}>
            <SectionHeader title={day} />
            <Card style={styles.day}>
              {daySlots.map((slot, i) => (
                <View key={slot.id}>
                  {i > 0 ? <Divider /> : null}
                  <SlotRow
                    slot={slot}
                    onClose={() => close(slot, !slot.isOpen)}
                    onRemove={() => remove(slot)}
                  />
                </View>
              ))}
            </Card>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function SlotRow({ slot, onClose, onRemove }) {
  const sold = slot.capacity - slot.placesLeft;
  const full = slot.placesLeft === 0;

  return (
    <View style={styles.slot}>
      <View style={styles.slotInfo}>
        <Text style={typography.cardTitle}>
          {timeOf(slot.startsAt)} – {timeOf(slot.endsAt)}
        </Text>
        <Text style={typography.meta}>{slot.productName}</Text>
        {slot.priceOverride ? (
          <Text style={typography.money}>{formatINR(slot.priceOverride)}</Text>
        ) : null}
      </View>

      <View style={styles.slotRight}>
        {/* The number a venue at its own gate is actually asking for. */}
        <StatusPill
          tone={!slot.isOpen ? 'muted' : full ? 'danger' : 'success'}
          label={!slot.isOpen ? 'Closed' : full ? 'Full' : `${slot.placesLeft} of ${slot.capacity} left`}
        />
        <View style={styles.slotActions}>
          <Button
            label={slot.isOpen ? 'Close' : 'Reopen'}
            variant="ghost"
            onPress={onClose}
          />
          {/* An hour somebody bought has no delete — see the header, decision 2. */}
          {sold === 0 ? <Button label="Remove" variant="ghost" onPress={onRemove} /> : null}
        </View>
      </View>
    </View>
  );
}

/** The form. One day, one window, cut into slots by the server. */
function OpenHours({ api, products, onCancel, onOpened }) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // `listInventory` rows are shelf rows: `id` is the shelf row, `productId` is
  // the thing. A slot belongs to the thing.
  const [productId, setProductId] = useState(products[0]?.productId ?? null);
  const [date, setDate] = useState(localDate(tomorrow));
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('22:00');
  const [slotMinutes, setSlotMinutes] = useState('60');
  const [capacity, setCapacity] = useState('1');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setError(null);

    if (!productId) {
      setError('Pick which pitch or court these hours are for.');
      return;
    }
    const opensAt = atLocalTime(date, openTime);
    const closesAt = atLocalTime(date, closeTime);
    if (!opensAt || !closesAt) {
      setError('Use a date like 2026-08-20 and times like 18:00.');
      return;
    }
    if (closesAt <= opensAt) {
      setError('The closing time has to be after the opening time.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.createSlots({
        productId,
        opensAt: opensAt.toISOString(),
        closesAt: closesAt.toISOString(),
        slotMinutes: Number.parseInt(slotMinutes, 10) || 60,
        capacity: Number.parseInt(capacity, 10) || 1,
        priceOverride: price === '' ? null : price
      });
      onOpened(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.form}>
      <SectionHeader title="Open hours for sale" />

      <Text style={typography.meta}>Which listing</Text>
      <View style={styles.picks}>
        {products.length === 0 ? (
          <Text style={typography.meta}>
            Nothing is listed yet. Add a pitch or a court under Stock first — an hour has to be an
            hour of something.
          </Text>
        ) : (
          products.map((p) => (
            <Button
              key={p.id}
              label={p.name}
              variant={p.productId === productId ? 'primary' : 'secondary'}
              onPress={() => setProductId(p.productId)}
            />
          ))
        )}
      </View>

      <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-08-20" />
      <View style={styles.pair}>
        <Field label="Opens" value={openTime} onChangeText={setOpenTime} placeholder="06:00" />
        <Field label="Closes" value={closeTime} onChangeText={setCloseTime} placeholder="22:00" />
      </View>
      <View style={styles.pair}>
        <Field
          label="Each slot (minutes)"
          value={slotMinutes}
          onChangeText={setSlotMinutes}
          keyboardType="number-pad"
        />
        <Field
          label="How many at once"
          value={capacity}
          onChangeText={setCapacity}
          keyboardType="number-pad"
        />
      </View>
      <Field
        label="Price for these hours"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="Leave blank to use your listed price"
      />

      {error ? <Banner tone="danger" message={error} /> : null}

      <Button label="Open these hours" onPress={submit} loading={busy} />
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
        autoCapitalize="none"
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  day: { gap: 0, paddingVertical: spacing.xs },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.sm
  },
  slotInfo: { flex: 1, gap: 2 },
  slotRight: { alignItems: 'flex-end', gap: spacing.xs },
  slotActions: { flexDirection: 'row', gap: spacing.xs },
  form: { gap: spacing.sm },
  picks: { gap: spacing.xs },
  pair: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    color: colors.ink,
    backgroundColor: colors.card
  }
});
