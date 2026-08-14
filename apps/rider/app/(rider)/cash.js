// COD cash the rider is holding, and the one button that hands it in.
//
// This is not a wallet and it is not earnings — it is the platform's money, in
// somebody's pocket, on a motorbike. `deliver()` records
// `collectedByRiderId` + `cashCollectedAt` the moment cash changes hands and
// leaves `cashRemittedAt` null; `GET /api/finance/cod-outstanding` is the other
// end of the same query, and it is what a district manager is looking at when
// they ask a rider where ₹4,200 is. So the number here has to match theirs
// exactly, which is why nothing on this screen is added up on the client.
//
// **Remitting is all-or-nothing, on purpose.** The endpoint hands in everything
// held, as one conditional `updateMany` re-asserting `cashRemittedAt: null` — so
// a double tap, or a delivery landing mid-request, cannot double-count or lose a
// payment that arrived in between. Per-order remittance would be a reconciliation
// the platform would then have to police, and the physical act it models is a
// rider emptying their pocket onto a counter.
//
// ✅ **HANDOFF §7.8a was answered on 2026-08-09**, and this is one of the two
// places it showed up (the other is `GET /api/finance/cod-outstanding`). A
// shop's own delivery boy hands his cash to his shop, never to RoadMate: the
// platform deducts it from that shop's weekly payout instead of collecting it.
// So this screen no longer implies he owes the platform anything — it tells him
// who to hand the cash to, which is the only thing he needs from it.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  SectionHeader,
  GroupedCard,
  GroupedRow,
  EmptyState,
  Button,
  Banner,
  connectionMessage,
  SkeletonCard,
  formatINR
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';

export default function Cash() {
  const api = useApi();
  const { isEmployedByShop, employer } = useSession();
  const [busy, setBusy] = useState(false);

  const cash = useResource(useCallback(() => api.getRemittance(), [api]), {
    cacheKey: 'remittance',
    intervalMs: POLL_MS.cash
  });

  const held = cash.data?.payments ?? [];
  const total = cash.data?.totalHeld ?? '0.00';
  const count = cash.data?.count ?? 0;

  const remit = () =>
    Alert.alert(
      `Hand in ${formatINR(total)}?`,
      `This records all ${count} ${
        count === 1 ? 'collection' : 'collections'
      } as handed in. Only tap it when the cash has actually changed hands.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Handed in',
          onPress: () =>
            cash.withPause(async () => {
              setBusy(true);
              try {
                const result = await api.remitCash();
                Alert.alert('Recorded', `${formatINR(result.totalRemitted)} marked as handed in.`);
              } catch (error) {
                Alert.alert(
                  error.isNetwork ? 'No connection' : 'Could not record that',
                  error.isNetwork
                    ? 'Could not reach RoadMate. Nothing was recorded — try again once you have signal.'
                    : error.message
                );
              } finally {
                setBusy(false);
              }
            })
        }
      ]
    );

  const problem = connectionMessage(cash.error);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={cash.refreshing} onRefresh={() => cash.reload()} tintColor={colors.accent} />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={() => cash.reload()} /> : null}

      <View style={styles.total}>
        <Text style={styles.totalLabel}>Cash in your hands</Text>
        <Text style={styles.totalAmount}>{formatINR(total)}</Text>
        <Text style={styles.totalNote}>
          {count === 0
            ? 'Nothing to hand in.'
            : `From ${count} cash ${count === 1 ? 'delivery' : 'deliveries'}.`}
        </Text>
      </View>

      {count > 0 ? (
        <Button label={`Hand in ${formatINR(total)}`} onPress={remit} loading={busy} disabled={busy} />
      ) : null}

      {isEmployedByShop ? (
        <Banner
          tone="info"
          message={`You deliver for ${
            employer?.name ?? 'your shop'
          }. Hand this cash to them, not to RoadMate — it is their money, and it is settled directly with them.`}
        />
      ) : null}

      <View>
        <SectionHeader title="Collections" />
        {cash.loading && !cash.data ? (
          <SkeletonCard count={2} />
        ) : held.length === 0 ? (
          <Card>
            <EmptyState
              title="No cash on you"
              message="Cash-on-delivery orders you complete show up here until you hand the money in."
            />
          </Card>
        ) : (
          <GroupedCard>
            {held.map((payment) => (
              <GroupedRow
                key={`${payment.consumerOrderId}`}
                label={`Order #${payment.consumerOrderId}`}
                sublabel={formatWhen(payment.collectedAt)}
                value={formatINR(payment.amount)}
              />
            ))}
          </GroupedCard>
        )}
      </View>
    </ScrollView>
  );
}

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}, ${d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
};

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  total: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: 2,
    alignItems: 'center'
  },
  totalLabel: { ...typography.sku },
  totalAmount: { fontSize: 34, fontWeight: '800', color: colors.ink },
  totalNote: { ...typography.meta }
});
