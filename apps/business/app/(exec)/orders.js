// The executive order book — the designed Orders screen from
// `designs/Partner.png`: a search field, then rows of
// `#RM-8231 • Kannan Motors`, a status pill, the amount and "Details ›".
//
// One thing the design could not show, because it only ever drew one role: a
// **distributor is on both sides**. `getOrders` returns
// `{ OR: [sellerId, buyerId] }` for it, so this list mixes what it must ship
// with what it has bought. Those are two different jobs — only the first has
// buttons — so they are two filters, and the seller half is the default.
//
// A regional partner is on neither side. Its rows are the trade happening in
// its region, read-only, and the filter row is hidden for it.
import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  Chip,
  OrderCard,
  EmptyState,
  Banner,
  connectionMessage,
  SearchField,
  SkeletonCard,
  formatAmount
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';
import { roleConfig } from '../../src/roles.js';
import { counterpartyOf, formatDate } from '../../src/tradeOrder.js';

export default function ExecOrders() {
  const { user } = useSession();
  const api = useApi();
  const router = useRouter();
  const config = roleConfig(user?.role);

  const orders = useResource(useCallback(() => api.listTradeOrders(), [api]), { intervalMs: POLL_MS.orders });
  const [search, setSearch] = useState('');
  const [side, setSide] = useState('selling');

  const all = orders.data?.orders ?? [];

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((order) => {
      if (config.sells) {
        const selling = order.sellerId === user?.id;
        if (side === 'selling' && !selling) return false;
        if (side === 'buying' && selling) return false;
      }
      if (!needle) return true;
      return `${order.orderNumber} ${counterpartyOf(order, user?.id)} ${order.status}`
        .toLowerCase()
        .includes(needle);
    });
  }, [all, search, side, config.sells, user?.id]);

  return (
    <View style={styles.flex}>
      <View style={styles.filters}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search order ID, buyer, or status"
        />
        {orders.error ? (
          <Banner message={connectionMessage(orders.error)} action="Retry" onAction={orders.reload} />
        ) : null}
        {config.sells ? (
          <View style={styles.chips}>
            <Chip label="To fulfil" selected={side === 'selling'} onPress={() => setSide('selling')} />
            <Chip label="My purchases" selected={side === 'buying'} onPress={() => setSide('buying')} />
          </View>
        ) : null}
      </View>

      {orders.loading && !orders.data ? (
        <View style={styles.list}>
          <SkeletonCard count={2} />
          <SkeletonCard count={2} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(order) => String(order.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={orders.refreshing} onRefresh={orders.reload} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <EmptyState
              title={search ? 'Nothing matches' : 'No orders here'}
              message={search ? 'Try the order number or the buyer’s name.' : emptyMessage(config, side)}
            />
          }
          /* The design's own row (`designs/Partner.png`, screen 3): title and
             pill, the meta line, then a rule with the amount bold at the left
             and "Details ›" opposite. `ListRow` stacked the pill and the amount
             in one narrow right-hand column, which put the figure a partner
             scans the list for into the smallest type on the row. */
          renderItem={({ item: order }) => (
            <OrderCard
              title={`#${order.orderNumber} • ${counterpartyOf(order, user?.id)}`}
              meta={`${formatDate(order.createdAt)} • ${order.items?.length ?? 0} item${
                order.items?.length === 1 ? '' : 's'
              }`}
              status={order.status}
              amount={formatAmount(order.totalAmount)}
              onPress={() => router.push(`/(exec)/order/${order.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

const emptyMessage = (config, side) => {
  if (!config.sells) return 'Trade in your region will appear here as it happens.';
  return side === 'selling'
    ? 'Orders placed with you will appear here. Add products so buyers can find you.'
    : 'Stock you order from your suppliers will appear here.';
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  filters: { padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { flexDirection: 'row', gap: spacing.sm },

  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: spacing.xxl }
});
