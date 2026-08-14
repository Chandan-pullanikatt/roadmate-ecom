// The shop's own delivery staff (HANDOFF §3, two delivery modes).
//
// A shop either uses RoadMate's delivery partners or its own delivery boys. The
// shop is the switch, and this screen is both halves of it: the switch itself,
// and the roster it depends on.
//
// Three things this screen exists to make legible, because getting any of them
// wrong is silent:
//
//   1. **The switch and the roster are one decision.** A shop that turns on
//      "my own delivery staff" with nobody hired stops receiving orders
//      altogether — it is unserviceable until somebody goes on shift. The
//      server allows that (setting up in either order is legitimate); the
//      screen is what stops it being a surprise, with a banner that names the
//      consequence rather than a toast that disappears.
//
//   2. **On shift is not available.** A boy can be signed in, on shift, and two
//      streets away with somebody else's order. The row says which, because
//      "why is my order not moving when Ravi is right there" is otherwise
//      unanswerable from this screen.
//
//   3. **Removing somebody is not deleting them.** It takes them off the
//      roster; it never turns them into a RoadMate delivery partner. The
//      confirmation says so.
//
// Not shown, deliberately: anything about what a delivery costs. RoadMate pays
// a shop's own boy nothing — the shop pays him, on terms the platform is not
// party to and has no figure for. And the three shop-delivery money questions
// (HANDOFF §7.8) are still open, so there is no number here that could be right.
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Switch,
  StyleSheet
} from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Button,
  Banner,
  connectionMessage,
  StatusPill,
  Divider,
  EmptyState,
  SkeletonCard
} from '@roadmate/ui';
import { useApi } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';

export default function DeliveryStaff() {
  const api = useApi();
  const [adding, setAdding] = useState(false);

  const roster = useResource(useCallback(() => api.listRiders(), [api]), {
    cacheKey: 'shop-riders',
    intervalMs: POLL_MS.riders
  });

  const riders = roster.data?.riders ?? [];
  const usesOwnRiders = roster.data?.usesOwnRiders ?? false;
  const problem = connectionMessage(roster.error);

  const active = riders.filter((r) => r.isActive);
  const onShift = active.filter((r) => r.isOnShift);

  const setMode = (next) =>
    roster.withPause(async () => {
      try {
        await api.setStorefront({ usesOwnRiders: next });
      } catch (error) {
        Alert.alert('Could not switch', error.message);
      }
    });

  const setActive = (rider, next) =>
    roster.withPause(async () => {
      try {
        await api.updateRider(rider.id, { isActive: next });
      } catch (error) {
        // RIDER_ON_JOB is an outcome, not a failure to retry — the same shape as
        // a 409 anywhere else in this app.
        Alert.alert(
          error.reason === 'RIDER_ON_JOB' ? 'They are out on a delivery' : 'Could not update',
          error.message
        );
      }
    });

  const confirmRemove = (rider) =>
    Alert.alert(
      `Remove ${rider.name}?`,
      'They will stop receiving your orders and will not be able to go on shift. This does not make them a RoadMate delivery partner — you can add them back at any time.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setActive(rider, false) }
      ]
    );

  return (
    <View style={styles.flex}>
      <FlatList
        data={riders}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={roster.refreshing} onRefresh={roster.reload} />}
        ListHeaderComponent={
          <View style={styles.header}>
            {problem ? <Banner message={problem} action="Retry" onAction={roster.reload} /> : null}

            <Card>
              <View style={styles.toggleRow}>
                <View style={styles.toggleText}>
                  <Text style={typography.body}>Deliver with my own staff</Text>
                  <Text style={typography.meta}>
                    {usesOwnRiders
                      ? 'Your orders go to your own delivery staff. RoadMate riders are not sent to you.'
                      : 'Your orders are collected by RoadMate delivery partners.'}
                  </Text>
                </View>
                <Switch
                  value={usesOwnRiders}
                  onValueChange={setMode}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor={colors.card}
                />
              </View>
            </Card>

            {/* The silent failure this screen exists to prevent: the switch is
                on and there is nobody to collect anything, so the shop simply
                stops appearing to customers. */}
            {usesOwnRiders && onShift.length === 0 ? (
              <Banner
                tone="danger"
                message={
                  active.length === 0
                    ? 'You are set to deliver with your own staff but have nobody on the roster. Customers cannot order from you until you add someone and they go on shift.'
                    : 'Nobody is on shift. Customers cannot order from you until one of your delivery staff signs in and goes on shift.'
                }
              />
            ) : null}

            <View style={styles.countRow}>
              <Text style={typography.sectionTitle}>Delivery staff</Text>
              <Text style={typography.meta}>
                {onShift.length} of {active.length} on shift
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <RiderRow rider={item} onRemove={() => confirmRemove(item)} onRestore={() => setActive(item, true)} />
        )}
        ListEmptyComponent={
          roster.loading ? (
            <SkeletonCard count={2} />
          ) : (
            <EmptyState
              title="No delivery staff yet"
              message="Add the people who deliver for you. They sign into the RoadMate Rider app with the phone number you enter here."
            />
          )
        }
      />

      <View style={styles.footer}>
        <Button label="Add delivery staff" onPress={() => setAdding(true)} />
      </View>

      <AddRiderSheet
        visible={adding}
        onClose={() => setAdding(false)}
        api={api}
        roster={roster}
      />
    </View>
  );
}

/** One person: who they are, and whether they can take an order right now. */
function RiderRow({ rider, onRemove, onRestore }) {
  const state = !rider.isActive
    ? { label: 'Removed', tone: 'danger' }
    : rider.liveJobs > 0
      ? { label: 'On a delivery', tone: 'info' }
      : rider.isOnShift
        ? { label: 'Available', tone: 'success' }
        : { label: 'Off shift', tone: 'muted' };

  return (
    <Card style={[styles.riderCard, !rider.isActive && styles.riderCardInactive]}>
      <View style={styles.riderTop}>
        <View style={styles.riderText}>
          <Text style={typography.body}>{rider.name}</Text>
          <Text style={typography.meta}>
            {[rider.phone, rider.vehicleType, rider.vehicleNumber].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusPill label={state.label} tone={state.tone} />
      </View>
      <Divider />
      {rider.isActive ? (
        <Button label="Remove from roster" variant="ghost" onPress={onRemove} />
      ) : (
        <Button label="Add back" variant="secondary" onPress={onRestore} />
      )}
    </Card>
  );
}

/**
 * Hiring one.
 *
 * The phone number is the sign-in ID, not a contact detail — that is why it is
 * labelled as such and why the server refuses anything that is not an Indian
 * mobile number. An account this person cannot sign into is worse than no
 * account: the shop believes it has a delivery boy.
 */
function AddRiderSheet({ visible, onClose, api, roster }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName('');
    setPhone('');
    setPassword('');
    setVehicleType('');
    setVehicleNumber('');
  };

  const save = () =>
    roster.withPause(async () => {
      setBusy(true);
      try {
        await api.addRider({
          name: name.trim(),
          phone: phone.trim(),
          password,
          vehicleType: vehicleType.trim() || undefined,
          vehicleNumber: vehicleNumber.trim() || undefined
        });
        reset();
        onClose();
      } catch (error) {
        Alert.alert(
          error.reason === 'PHONE_TAKEN' ? 'That number is already in use' : 'Could not add',
          error.message
        );
      } finally {
        setBusy(false);
      }
    });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>Add delivery staff</Text>
          <Text style={typography.meta}>
            They sign into the RoadMate Rider app with this number and password, go on shift, and your orders are sent to
            them.
          </Text>

          <Field label="Name" value={name} onChangeText={setName} placeholder="Ravi Kumar" />
          <Field
            label="Phone number (their sign-in ID)"
            value={phone}
            onChangeText={setPhone}
            placeholder="9876500123"
            keyboardType="phone-pad"
            maxLength={14}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            secureTextEntry
          />
          <Field label="Vehicle (optional)" value={vehicleType} onChangeText={setVehicleType} placeholder="Bike" />
          <Field
            label="Vehicle number (optional)"
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
            placeholder="KA 01 AB 1234"
            autoCapitalize="characters"
          />

          <Button
            label="Add"
            onPress={save}
            loading={busy}
            disabled={!name.trim() || !phone.trim() || password.length < 6}
          />
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, ...input }) {
  return (
    <View style={styles.field}>
      <Text style={typography.meta}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="words"
        {...input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 96 },
  header: { gap: spacing.md },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleText: { flex: 1, gap: 2 },

  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  riderCard: { gap: spacing.sm },
  riderCardInactive: { opacity: 0.6 },
  riderTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  riderText: { flex: 1, gap: 2 },

  footer: {
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },

  backdrop: { flex: 1, backgroundColor: '#00000055' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md
  },
  field: { gap: 4 },
  input: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    color: colors.ink
  }
});
