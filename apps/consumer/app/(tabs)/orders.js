// Every order this customer has placed — live ones first, then history.
//
// The split is the only thing this screen decides, and it matters because a
// live order is a thing you are waiting for and a delivered one is a receipt.
// `GET /api/customer/orders` returns the 50 most recent; there is no pagination
// behind it, and adding one would be inventing a need nobody has yet.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  typography,
  Card,
  OrderCard,
  SectionHeader,
  EmptyState,
  Banner,
  Button,
  connectionMessage,
  SkeletonCard,
  formatINR
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi } from '../../src/session.js';
import { POLL_MS } from '../../src/config.js';
import { isLive, stageMessage, formatWhen } from '../../src/order.js';

export default function Orders() {
  const api = useApi();
  const router = useRouter();

  const orders = useResource(useCallback(() => api.listOrders(), [api]), {
    cacheKey: 'orders',
    intervalMs: POLL_MS.orders
  });

  const all = orders.data?.orders ?? [];
  const live = all.filter(isLive);
  const past = all.filter((order) => !isLive(order));
  const problem = connectionMessage(orders.error);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={orders.refreshing} onRefresh={() => orders.reload()} tintColor={colors.accent} />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={() => orders.reload()} /> : null}

      <View>
        <SectionHeader title="Now" action={live.length ? `${live.length}` : undefined} />
        {orders.loading && !orders.data ? (
          <SkeletonCard count={2} />
        ) : live.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing on the way"
              message="Orders you place appear here while they are being packed and delivered."
              action={<Button label="Start shopping" onPress={() => router.push('/(tabs)')} />}
            />
          </Card>
        ) : (
          <View style={styles.stack}>
            {live.map((order) => (
              <Row key={order.id} order={order} onPress={() => router.push(`/order/${order.id}`)} />
            ))}
          </View>
        )}
      </View>

      <View>
        <SectionHeader title="Earlier" />
        {past.length === 0 ? (
          <Card>
            <EmptyState title="No past orders" message="Everything you have received is kept here." />
          </Card>
        ) : (
          <View style={styles.stack}>
            {past.map((order) => (
              <Row key={order.id} order={order} onPress={() => router.push(`/order/${order.id}`)} />
            ))}
          </View>
        )}
        <Text style={styles.footnote}>Your 50 most recent orders.</Text>
      </View>
    </ScrollView>
  );
}

function Row({ order, onPress }) {
  return (
    <OrderCard
      // The shop is null until one accepts (HANDOFF §3) — an order is not bound
      // to a shop at placement — so this says what is true right now rather than
      // naming a shop that may yet be rerouted away.
      title={`${order.orderNumber}${order.shop ? ` · ${order.shop.name}` : ''}`}
      meta={[formatWhen(order.placedAt), `${order.items.length} item${order.items.length === 1 ? '' : 's'}`]
        .filter(Boolean)
        .join(' · ')}
      status={order.status}
      statusLabel={isLive(order) ? stageMessage(order.status) : undefined}
      amount={formatINR(order.grandTotal)}
      action="Track"
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  stack: { gap: spacing.md },
  footnote: { ...typography.meta, marginTop: spacing.md, textAlign: 'center' }
});
