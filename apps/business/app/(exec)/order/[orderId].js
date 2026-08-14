// A B2B trade order in detail — the design's "Details ›" destination.
//
// Polished in-house against HANDOFF §5 and `designs/Partner.png` (2026-08-07).
// Read the next paragraph before changing anything here.
//
// The whole reason this screen has buttons is `updateOrderStatus`, and that
// endpoint is sharper than it looks:
//
//   • **Approved and Dispatched each decrement `Product.stockLevel`.** The
//     controller does not guard against being called twice, so setting the same
//     status again quietly takes the stock down a second time. This screen only
//     ever offers the *one* next rung of the ladder, never a status picker, and
//     never the status the order is already on.
//   • **Delivered writes the commission payouts.** It resolves the buyer's
//     onboarding hierarchy and pays STATE / IND_STATE / DISTRICT / REGIONAL /
//     MASTER out of a 15% pool. That is the undocumented 15 from
//     `orderController.js:196` (PLAN §7.1) — so the button says what it does
//     ("pays out the partner commission splits") and this screen shows **no
//     percentage and no split figures**. A number the client has never
//     confirmed must not appear on an executive's screen as if it were policy.
//   • Only the **seller** can move an order. A buyer viewing its own purchase
//     gets the same screen with no buttons, which is the honest shape: it is
//     watching, not acting.
//
// ⚠️ The ladder below is drawn as a timeline now. It is **display only**. Every
// rung except the next one is inert text — there is no `onPress` on a step and
// there must never be one. The visual affordance of a row of statuses is exactly
// the affordance this endpoint cannot survive.
//
// Money here is B2B `Float` throughout — `formatAmount`, never `formatINR`.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  GroupedCard,
  GroupedRow,
  StatusPill,
  KeyValue,
  Divider,
  Button,
  Banner,
  connectionMessage,
  StickyFooter,
  SkeletonCard,
  EmptyState,
  Sku,
  formatAmount,
  prettyStatus
} from '@roadmate/ui';
import { useApi, useSession } from '../../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../../src/config.js';
import { counterpartyOf, isSeller, nextStep, LADDER_STEPS, formatDateTime } from '../../../src/tradeOrder.js';

export default function ExecOrderDetail() {
  const { orderId } = useLocalSearchParams();
  const { user } = useSession();
  const api = useApi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // There is no per-order endpoint — `GET /api/orders` is already scoped to
  // this user by role, so this reads from that list rather than adding a route
  // for one screen. (The shop's order detail does the same thing.)
  const orders = useResource(useCallback(() => api.listTradeOrders(), [api]), {
    cacheKey: 'trade-orders',
    intervalMs: POLL_MS.orders
  });
  const order = (orders.data?.orders ?? []).find((o) => String(o.id) === String(orderId));

  if (!order) {
    if (orders.loading && !orders.data) {
      return (
        <View style={styles.loading}>
          <SkeletonCard count={2} />
          <SkeletonCard count={4} />
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <EmptyState
          title="This order is not yours"
          message="It may belong to another account, or have been removed."
          action={<Button label="Back to orders" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  const selling = isSeller(order, user?.id);
  const step = selling ? nextStep(order.status) : null;
  const problem = connectionMessage(orders.error);
  const cancelled = order.status === 'Cancelled';

  const advance = () =>
    Alert.alert(step.label, `${step.note}\n\nThis cannot be undone from the app.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: step.label,
        onPress: () =>
          // `withPause` matters here for the same reason it does on the shop
          // side: this endpoint is not idempotent, and a poll landing mid-write
          // that redraws the button is how a second tap happens.
          orders.withPause(async () => {
            setBusy(true);
            try {
              await api.setTradeOrderStatus(order.id, step.status);
            } catch (error) {
              Alert.alert('Could not update', error.message);
            } finally {
              setBusy(false);
            }
          })
      }
    ]);

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={
          <RefreshControl refreshing={orders.refreshing} onRefresh={orders.reload} tintColor={colors.accent} />
        }
      >
        {problem ? <Banner message={problem} action="Retry" onAction={orders.reload} /> : null}

        <Card style={styles.head}>
          <View style={styles.headRow}>
            <Text style={typography.screenTitle}>#{order.orderNumber}</Text>
            <StatusPill status={order.status} />
          </View>
          <Text style={typography.meta}>
            {selling ? 'Ordered by' : 'Ordered from'} {counterpartyOf(order, user?.id)}
          </Text>
          <Text style={typography.meta}>{formatDateTime(order.createdAt)}</Text>
          {cancelled ? null : <Ladder status={order.status} />}
        </Card>

        <View>
          <Text style={styles.groupLabel}>{selling ? 'Ship this' : 'You ordered'}</Text>
          <Card>
            {(order.items ?? []).map((item, index) => (
              <View key={item.id ?? index} style={[styles.item, index > 0 && styles.itemRuled]}>
                <View style={styles.qtyChip}>
                  <Text style={styles.qtyText}>{item.quantity}</Text>
                </View>
                <View style={styles.itemBody}>
                  <Sku>{item.product?.sku}</Sku>
                  <Text style={typography.cardTitle}>{item.product?.name ?? 'Product'}</Text>
                  <Text style={typography.meta}>{formatAmount(item.price)} / unit</Text>
                </View>
                <Text style={typography.body}>{formatAmount(item.price * item.quantity)}</Text>
              </View>
            ))}
            <Divider />
            {/* `totalAmount` is the server's own figure, not a re-sum of the lines.
                B2B money is Float and the ledger's number is the one that matters. */}
            <KeyValue label="Order total" value={formatAmount(order.totalAmount)} strong />
          </Card>
        </View>

        <View>
          <Text style={styles.groupLabel}>Parties</Text>
          <GroupedCard>
            <GroupedRow label="Buyer" value={order.buyer?.businessName || order.buyer?.name || '—'} />
            <GroupedRow label="Seller" value={order.seller?.businessName || order.seller?.name || '—'} />
            <GroupedRow label="Industry" value={order.industry?.name ?? '—'} />
          </GroupedCard>
        </View>

        {step ? null : (
          <Card style={[styles.closing, cancelled && styles.closingBad]}>
            <Text style={typography.cardTitle}>{selling ? closingTitle(order.status) : 'Waiting on your supplier'}</Text>
            <Text style={typography.meta}>
              {selling
                ? order.status === 'Delivered'
                  ? 'This order is closed and its partner commissions have been paid out.'
                  : `This order is ${prettyStatus(order.status).toLowerCase()} and has no next step in the app.`
                : 'Only the seller can move this order along. You will see the status change here.'}
            </Text>
          </Card>
        )}
      </ScrollView>

      {/* Exactly one rung, pinned. Never a picker — see the header comment. */}
      {step ? (
        <StickyFooter>
          <Button label={step.label} onPress={advance} loading={busy} />
          <Text style={styles.note}>{step.note}</Text>
        </StickyFooter>
      ) : null}
    </View>
  );
}

const closingTitle = (status) => (status === 'Delivered' ? 'Order complete' : 'Nothing left to do');

/**
 * Where the order sits on the fixed ladder. **Display only** — no step is
 * pressable, by design (see the header comment: a row of tappable statuses is
 * precisely what this endpoint cannot survive).
 */
function Ladder({ status }) {
  const index = LADDER_STEPS.findIndex((s) => s === status);
  const inset = `${50 / LADDER_STEPS.length}%`;
  const progress = index <= 0 ? 0 : (index / (LADDER_STEPS.length - 1)) * 100;

  return (
    <View style={styles.ladder} accessibilityRole="progressbar" accessibilityValue={{ text: prettyStatus(status) }}>
      <View style={[styles.track, { left: inset, right: inset }]}>
        <View style={[styles.trackFill, { width: `${progress}%` }]} />
      </View>
      {LADDER_STEPS.map((label, i) => {
        const done = i <= index;
        return (
          <View key={label} style={styles.ladderStep}>
            <View style={[styles.dot, done && styles.dotDone, i === index && styles.dotCurrent]} />
            <Text style={[typography.meta, done && styles.stepDone]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  loading: { flex: 1, backgroundColor: colors.page, padding: spacing.lg, gap: spacing.lg },
  center: { flex: 1, justifyContent: 'center', backgroundColor: colors.page },

  head: { gap: spacing.xs },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },

  groupLabel: { ...typography.sectionTitle, marginBottom: spacing.md },

  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  itemRuled: { borderTopWidth: 1, borderTopColor: colors.border },
  itemBody: { flex: 1, gap: 2 },
  qtyChip: {
    minWidth: 28,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.page,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  qtyText: { fontSize: 13, fontWeight: '700', color: colors.ink },

  note: { ...typography.meta, textAlign: 'center' },
  closing: { backgroundColor: colors.infoSoft, gap: spacing.xs },
  closingBad: { backgroundColor: colors.dangerSoft },

  ladder: { flexDirection: 'row', marginTop: spacing.lg },
  ladderStep: { flex: 1, alignItems: 'center', gap: spacing.sm },
  track: { position: 'absolute', top: 5, height: 2, backgroundColor: colors.border },
  trackFill: { height: '100%', backgroundColor: colors.accent },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.accent },
  dotCurrent: { borderWidth: 3, borderColor: colors.accentSoft, width: 14, height: 14, borderRadius: 7 },
  stepDone: { color: colors.ink, fontWeight: '600' }
});
