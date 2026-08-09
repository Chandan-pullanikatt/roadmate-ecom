// Executive Home — the designed Partner home screen (greeting → stat tiles →
// Quick Actions → recent list), for all three executive roles.
//
// The tiles are not a fixed set: `dashboardController.getOverview` returns a
// *different set of keys per role*, so `src/roles.js` names the ones each role
// gets and this screen renders that list. Nothing here knows what a
// manufacturer is.
//
// **No commission percentage anywhere**, same rule as the shop's screens.
// `commission_percent` still defaults to the undocumented 15 from
// `orderController.js:196` (PLAN §7.1). Regional's `myShare` is safe to show
// and is shown: it is a figure the server computed and returned, not a rate
// this screen would be asserting.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  typography,
  Card,
  SectionHeader,
  GreetingHeader,
  StatGrid,
  StatTile,
  QuickActions,
  ListRow,
  StatusPill,
  EmptyState,
  Banner,
  formatAmount,
  formatCompact
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';
import { roleConfig } from '../../src/roles.js';
import { counterpartyOf, formatDate } from '../../src/tradeOrder.js';
import { billingBanner } from '../../src/billing.js';

export default function ExecHome() {
  const { user } = useSession();
  const api = useApi();
  const router = useRouter();
  const config = roleConfig(user?.role);

  const overview = useResource(useCallback(() => api.getOverview(), [api]), { intervalMs: POLL_MS.overview });
  // A Distributor and a Manufacturer are billed a monthly fee; a Regional
  // partner is not, and `getBilling` answers `billable: false` for them, which
  // `billingBanner` turns into no banner at all.
  const billing = useResource(useCallback(() => api.getBilling(), [api]));
  const orders = useResource(useCallback(() => api.listTradeOrders(), [api]), { intervalMs: POLL_MS.orders });
  const approvals = useResource(useCallback(() => api.getPendingApprovals(), [api]), {
    enabled: config.tabs.network
  });

  const stats = overview.data?.stats ?? {};
  const orderList = orders.data?.orders ?? [];
  const pending = approvals.data?.approvals ?? [];
  const banner = billingBanner(billing.data);

  // A seller's own queue. `getOrders` gives a distributor both halves — what it
  // bought and what it must ship — and "waiting on you" is only the second.
  const awaitingMe = config.sells
    ? orderList.filter((o) => o.sellerId === user?.id && ['Pending', 'Approved'].includes(o.status))
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={
          <RefreshControl
            refreshing={overview.refreshing}
            onRefresh={() => {
              overview.reload();
              orders.reload();
              if (config.tabs.network) approvals.reload();
            }}
            tintColor={colors.accent}
          />
        }
      >
        <GreetingHeader
          name={user?.businessName || user?.name}
          hasAlerts={awaitingMe.length > 0 || pending.length > 0}
          onBellPress={() => router.push('/(exec)/orders')}
        />

        {banner ? (
          <Banner
            message={banner.message}
            tone={banner.tone}
            action={banner.action}
            onAction={() => router.push('/subscription')}
          />
        ) : null}

        {pending.length > 0 ? (
          <Card style={styles.alert} onPress={() => router.push('/(exec)/network')}>
            <Text style={typography.sectionTitle}>
              {pending.length === 1 ? '1 partner waiting for approval' : `${pending.length} partners waiting for approval`}
            </Text>
            <Text style={[typography.meta, styles.alertMeta]}>
              They cannot trade until you approve them.
            </Text>
          </Card>
        ) : null}

        {awaitingMe.length > 0 ? (
          <Card style={styles.alertInfo} onPress={() => router.push('/(exec)/orders')}>
            <Text style={typography.sectionTitle}>
              {awaitingMe.length === 1 ? '1 order to dispatch' : `${awaitingMe.length} orders to dispatch`}
            </Text>
            <Text style={[typography.meta, styles.alertMeta]}>Confirm and ship to keep your buyers stocked.</Text>
          </Card>
        ) : null}

        <StatGrid>
          {config.stats.map((stat) => (
            <StatTile
              key={stat.key}
              label={stat.label}
              icon={stat.icon}
              // Money is B2B `Float` here, so `formatAmount`, never `formatINR`
              // — and compact, because a stat tile has no room for paise.
              value={stat.money ? formatCompact(stats[stat.key] ?? 0) : String(stats[stat.key] ?? 0)}
            />
          ))}
        </StatGrid>

        <View>
          <SectionHeader title="Quick actions" />
          <QuickActions
            items={[
              { label: 'Orders', icon: '▤', onPress: () => router.push('/(exec)/orders') },
              ...(config.tabs.products
                ? [{ label: 'Products', icon: '▦', onPress: () => router.push('/(exec)/products') }]
                : []),
              ...(config.tabs.network
                ? [{ label: 'Network', icon: '🤝', onPress: () => router.push('/(exec)/network') }]
                : []),
              { label: 'Profile', icon: '☺', onPress: () => router.push('/(exec)/profile') }
            ]}
          />
        </View>

        <View>
          <SectionHeader title={config.ordersTitle} action="See all" onAction={() => router.push('/(exec)/orders')} />
          <Card>
            {orderList.length === 0 ? (
              <EmptyState
                title="No orders yet"
                message={
                  orders.error
                    ? orders.error.message
                    : config.sells
                      ? 'Orders placed with you will appear here.'
                      : 'Trade in your region will appear here as it happens.'
                }
              />
            ) : (
              orderList.slice(0, 5).map((order, index) => (
                <ListRow
                  key={order.id}
                  title={`#${order.orderNumber} • ${counterpartyOf(order, user?.id)}`}
                  meta={`${formatDate(order.createdAt)} • ${order.items?.length ?? 0} item${
                    order.items?.length === 1 ? '' : 's'
                  }`}
                  onPress={() => router.push(`/(exec)/order/${order.id}`)}
                  right={
                    <>
                      <StatusPill status={order.status} />
                      <Text style={typography.money}>{formatAmount(order.totalAmount)}</Text>
                    </>
                  }
                  style={index > 0 && styles.divided}
                />
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },

  alert: { backgroundColor: colors.accentSoft, gap: spacing.xs },
  alertInfo: { backgroundColor: colors.infoSoft, gap: spacing.xs },
  alertMeta: { color: colors.ink },

  divided: { borderTopWidth: 1, borderTopColor: colors.border }
});
