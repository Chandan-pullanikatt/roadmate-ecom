// Profile — the designed Partner profile screen: business details, operating
// hours, preferences, and a red Log out.
//
// The one thing it deliberately does not show is what the shop earns per order.
// The commission split is frozen at delivery from `PlatformConfig`, whose
// `commission_percent` still defaults to the undocumented 15 from
// `orderController.js:196` — a number the client has never confirmed (PLAN §7.1).
// Putting it here would present a placeholder as an agreed rate, which is the
// one number Phase 2's UI could leak. Settlement figures are real and could be
// shown; a live percentage cannot.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Switch, Alert, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Avatar,
  Divider,
  Button,
  KeyValue
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';

export default function Profile() {
  const { user, signOut } = useSession();
  const api = useApi();
  const router = useRouter();

  const storefront = useResource(useCallback(() => api.getStorefront(), [api]), {
    cacheKey: 'storefront'
  });
  const current = storefront.data?.storefront;
  const [editingHours, setEditingHours] = useState(false);

  const setOpen = (isOpen) =>
    storefront.withPause(async () => {
      try {
        await api.setStorefront({ isOpen });
      } catch (error) {
        Alert.alert('Could not update', error.message);
      }
    });

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card style={styles.identity}>
        <Avatar name={user?.businessName || user?.name} size={52} />
        <View style={styles.identityText}>
          <Text style={typography.sectionTitle}>{user?.businessName || user?.name}</Text>
          <Text style={typography.meta}>
            {[user?.name, 'Owner'].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Card>

      <Card>
        <Text style={typography.sectionTitle}>Business</Text>
        <Divider />
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={typography.body}>Accepting customer orders</Text>
            <Text style={typography.meta}>
              When this is off your shop is skipped when orders are routed.
            </Text>
          </View>
          <Switch
            value={current?.isOpen ?? false}
            onValueChange={setOpen}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.card}
          />
        </View>
        <Divider />
        <KeyValue
          label="Operating hours"
          value={current?.openTime && current?.closeTime ? `${current.openTime} – ${current.closeTime}` : 'Not set'}
        />
        <Button
          label={editingHours ? 'Done' : 'Change hours'}
          variant="ghost"
          onPress={() => setEditingHours((v) => !v)}
        />
        {editingHours ? <HoursEditor api={api} storefront={storefront} current={current} /> : null}

        <Divider />
        <KeyValue label="Industry" value={user?.industry?.name ?? '—'} />
        <KeyValue label="GST" value={user?.gstNumber ?? 'Not provided'} />
        <KeyValue label="Phone" value={user?.phone ?? '—'} />
        <KeyValue label="Email" value={user?.email ?? '—'} />
      </Card>

      <Card>
        <Text style={typography.sectionTitle}>Stock protection</Text>
        <Divider />
        <KeyValue
          label="Safety buffer"
          value={current?.safetyStockBuffer != null ? `${current.safetyStockBuffer}%` : '—'}
        />
        <Text style={typography.meta}>
          Customers are only offered this share of your free stock, so walk-in sales at the counter can't oversell the
          app. Set by RoadMate, not from here.
        </Text>
      </Card>

      <Card>
        <Text style={typography.sectionTitle}>Delivery</Text>
        <Divider />
        <KeyValue
          label="Orders are delivered by"
          value={current?.usesOwnRiders ? 'Your own staff' : 'RoadMate delivery partners'}
        />
        <Text style={typography.meta}>
          Switch between the two, and manage the people who deliver for you. Your own staff only ever receive your
          orders.
        </Text>
        <Button
          label="Delivery staff"
          variant="secondary"
          onPress={() => router.push('/(shop)/delivery')}
        />
      </Card>

      <Card>
        <Text style={typography.sectionTitle}>Subscription</Text>
        <Divider />
        <Text style={typography.meta}>
          Your free trial, your monthly fee, and every invoice RoadMate has raised.
        </Text>
        <Button
          label="Subscription & invoices"
          variant="secondary"
          onPress={() => router.push('/subscription')}
        />
      </Card>

      <Card>
        <Text style={typography.sectionTitle}>Counter</Text>
        <Divider />
        <Button label="Redeem a membership voucher" variant="secondary" onPress={() => router.push('/(shop)/vouchers')} />
      </Card>

      <Button
        label="Log out"
        variant="danger"
        onPress={() =>
          Alert.alert('Log out?', 'You will stop receiving customer orders on this device.', [
            { text: 'Stay', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: signOut }
          ])
        }
      />
    </ScrollView>
  );
}

/** "HH:MM" — the only shape the API and the dashboards store. */
function HoursEditor({ api, storefront, current }) {
  const [openTime, setOpenTime] = useState(current?.openTime ?? '');
  const [closeTime, setCloseTime] = useState(current?.closeTime ?? '');
  const [busy, setBusy] = useState(false);

  const save = () =>
    storefront.withPause(async () => {
      setBusy(true);
      try {
        await api.setStorefront({ openTime: openTime || null, closeTime: closeTime || null });
      } catch (error) {
        Alert.alert('Could not save', error.message);
      } finally {
        setBusy(false);
      }
    });

  return (
    <View style={styles.hours}>
      <View style={styles.hoursRow}>
        <TextInput
          style={styles.timeInput}
          value={openTime}
          onChangeText={setOpenTime}
          placeholder="09:00"
          placeholderTextColor={colors.inkFaint}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
        <Text style={typography.meta}>to</Text>
        <TextInput
          style={styles.timeInput}
          value={closeTime}
          onChangeText={setCloseTime}
          placeholder="20:00"
          placeholderTextColor={colors.inkFaint}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
      </View>
      <Button label="Save hours" onPress={save} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  toggleText: { flex: 1, gap: 2 },

  hours: { gap: spacing.md, marginTop: spacing.sm },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  timeInput: {
    flex: 1,
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    textAlign: 'center',
    color: colors.ink
  }
});
