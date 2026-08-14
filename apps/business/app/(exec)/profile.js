// Executive Profile — the designed Partner profile screen: identity, business
// details, and a red Log out.
//
// It carries one thing the shop's profile does not: **earnings**, for the roles
// that have them. A regional partner is a commission recipient
// (`orderController.updateOrderStatus` splits a pool to STATE / IND_STATE /
// DISTRICT / REGIONAL / MASTER), so `GET /api/payouts` returns real, settled
// rows for it.
//
// Those are safe to show precisely because they are **settled figures, not a
// live rate**. `commission_percent` still defaults to the undocumented 15 from
// `orderController.js:196` and the client has never confirmed it (PLAN §7.1) —
// so this screen shows what each payout *was*, and never the percentage that
// produced it. Same rule as every other screen in this app.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  typography,
  Card,
  Avatar,
  Divider,
  Button,
  KeyValue,
  ListRow,
  StatusPill,
  EmptyState,
  formatAmount
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { roleConfig } from '../../src/roles.js';
import { formatDate } from '../../src/tradeOrder.js';

export default function ExecProfile() {
  const { user, signOut } = useSession();
  const api = useApi();
  const router = useRouter();
  const config = roleConfig(user?.role);

  const payouts = useResource(useCallback(() => api.listPayouts(), [api]), {
    cacheKey: 'payouts',
    enabled: config.tabs.payouts
  });
  const payoutList = payouts.data?.payouts ?? [];

  // B2B `Float`, so a plain sum is correct here — the same arithmetic the web
  // dashboards already do on these columns. The B2C integer-paise rule is about
  // Decimal strings and does not apply.
  const settled = payoutList
    .filter((p) => p.status === 'Settled')
    .reduce((sum, p) => sum + (p.amount ?? 0), 0);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        config.tabs.payouts ? (
          <RefreshControl refreshing={payouts.refreshing} onRefresh={payouts.reload} tintColor={colors.accent} />
        ) : undefined
      }
    >
      <Card style={styles.identity}>
        <Avatar name={user?.businessName || user?.name} size={52} />
        <View style={styles.identityText}>
          <Text style={typography.sectionTitle}>{user?.businessName || user?.name}</Text>
          <Text style={typography.meta}>{[user?.name, config.label].filter(Boolean).join(' · ')}</Text>
        </View>
      </Card>

      <Card>
        <Text style={typography.sectionTitle}>Business</Text>
        <Divider />
        <KeyValue label="Industry" value={user?.industry?.name ?? '—'} />
        <KeyValue label="GST" value={user?.gstNumber ?? 'Not provided'} />
        <KeyValue label="Phone" value={user?.phone ?? '—'} />
        <KeyValue label="Email" value={user?.email ?? '—'} />
      </Card>

      <Card>
        <Text style={typography.sectionTitle}>Territory</Text>
        <Divider />
        <KeyValue label="State" value={user?.stateName ?? '—'} />
        <KeyValue label="District" value={user?.districtName ?? '—'} />
        {user?.regionName ? <KeyValue label="Region" value={user.regionName} /> : null}
        <Text style={typography.meta}>
          Set by RoadMate when your account was created. Contact your onboarding partner to change it.
        </Text>
      </Card>

      {config.tabs.payouts ? (
        <Card>
          <Text style={typography.sectionTitle}>Your earnings</Text>
          <Divider />
          <KeyValue label="Settled to date" value={formatAmount(settled)} strong />
          {payoutList.length === 0 ? (
            <EmptyState
              title="Nothing settled yet"
              message="You earn a share of every order delivered in your region. Payouts appear here once an order is marked delivered."
            />
          ) : (
            payoutList.slice(0, 10).map((payout, index) => (
              <ListRow
                key={payout.id}
                title={payout.order?.orderNumber ? `#${payout.order.orderNumber}` : `Payout #${payout.id}`}
                meta={`${formatDate(payout.createdAt)} • order ${formatAmount(payout.order?.totalAmount ?? 0)}`}
                right={
                  <>
                    <StatusPill status={payout.status} />
                    <Text style={typography.money}>{formatAmount(payout.amount)}</Text>
                  </>
                }
                style={index > 0 && styles.divided}
              />
            ))
          )}
        </Card>
      ) : null}

      {/* A Distributor and a Manufacturer pay a monthly fee; a Regional partner
          does not, and the screen behind this says so rather than being hidden
          — one link is cheaper than a role table, and being told "you aren't
          billed" is a useful answer. */}
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

      <Button
        label="Log out"
        variant="danger"
        onPress={() =>
          Alert.alert('Log out?', 'You will need your email and password to sign back in.', [
            { text: 'Stay', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: signOut }
          ])
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: 2 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border }
});
