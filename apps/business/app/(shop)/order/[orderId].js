// The order lifecycle: accepted → packing → ready.
//
// Polished in-house against HANDOFF §5 and `designs/Partner.png` (2026-08-07).
// The visual pass did not touch the mechanics below, all of which still hold.
//
// Three things this screen is careful about:
//
//   • **READY summons the rider.** Marking ready is not a label change — it is
//     what creates and assigns the delivery job (§1.7). The button says so.
//   • **Stockout is expensive and irreversible.** It unbinds the order, reroutes
//     it, and counts against the SKU; three in a row hide it until the shop
//     recounts. It is behind a confirmation and it explains the consequence.
//   • **No commission anywhere.** `commission_percent` still defaults to the
//     undocumented 15 from `orderController.js:196` and has never been confirmed
//     by the client. What the shop is owed is settled weekly from figures frozen
//     at delivery; putting a live percentage on this screen would present a
//     placeholder as policy. The API does not send it, and this screen does not
//     ask. (PLAN §7.1.)
//
// What the polish changed:
//
//   • **The forward action is pinned.** It used to sit at the end of the scroll,
//     below the item list — on a ten-line order that is below the fold, and a
//     forward step taken late is a promised ETA already burning.
//   • **The destructive action deliberately did not move with it.** "I can't
//     fulfil this" stays in the body, away from the primary. Putting an
//     irreversible reroute next to the button the shop taps every few minutes is
//     how a mistap happens.
//   • **The timeline is drawn properly.** The old one positioned its connectors
//     with `left: '50%', right: '-50%'`, which React Native does not lay out the
//     way that reads; the track is now one bar behind the dots with a fill.
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
  formatINR,
  prettyStatus,
  addMoney,
  mulMoney
} from '@roadmate/ui';
import { useApi } from '../../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../../src/config.js';

/** What the shop can do next, and what it means when it does it. */
const NEXT_STEP = {
  ACCEPTED: { status: 'PREPARING', label: 'Start packing', note: 'Tells the customer you have started.' },
  PREPARING: {
    status: 'READY',
    label: 'Mark ready for pickup',
    note: 'This calls a rider to collect the order.'
  }
};

export default function OrderDetail() {
  const { orderId } = useLocalSearchParams();
  const api = useApi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // There is no per-order shop endpoint — `GET /api/shop/orders` is the shop's
  // whole book and it is short (100 rows, its own orders only), so this reads
  // from it rather than adding an endpoint for one screen.
  const orders = useResource(useCallback(() => api.listOrders(), [api]), { intervalMs: POLL_MS.orders });
  const order = (orders.data?.orders ?? []).find((o) => String(o.id) === String(orderId));

  if (!order) {
    // Two genuinely different states that used to share one blank screen: the
    // first fetch is in flight, or the order really is not this shop's.
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
          message="It may have been rerouted to another shop, or already delivered and archived."
          action={<Button label="Back to orders" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  const step = NEXT_STEP[order.status];
  const live = ['ACCEPTED', 'PREPARING', 'READY'].includes(order.status);

  const advance = () =>
    orders.withPause(async () => {
      setBusy(true);
      try {
        await api.setOrderStatus(order.id, step.status);
      } catch (error) {
        // A 409 here means the order is no longer where this screen thought it
        // was — someone else moved it, or a stockout unbound it. Refreshing is
        // the fix; retrying the same transition is not.
        Alert.alert(error.isConflict ? 'This order has moved on' : 'Could not update', error.message);
      } finally {
        setBusy(false);
      }
    });

  const reportStockout = () =>
    Alert.alert(
      'Out of stock?',
      'The order leaves your shop and goes to another one. Repeated stockouts on the same item hide it from customers until you recount it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "I can't fulfil this",
          style: 'destructive',
          onPress: () =>
            orders.withPause(async () => {
              setBusy(true);
              try {
                await api.reportStockout(order.id, 'Out of stock after accepting');
                router.replace('/(shop)/orders');
              } catch (error) {
                Alert.alert(error.isConflict ? 'This order has moved on' : 'Could not report', error.message);
              } finally {
                setBusy(false);
              }
            })
        }
      ]
    );

  // Exact, in integer paise: the goods total the shop is packing. Not the bill —
  // delivery fee, tax and any coupon belong to the customer's total and are not
  // this screen's to restate.
  const goodsTotal = order.items.reduce((sum, item) => addMoney(sum, mulMoney(item.unitPrice, item.quantity)), '0.00');
  const problem = connectionMessage(orders.error);
  const dropLine =
    [order.dropArea?.landmark, order.dropArea?.city, order.dropArea?.pincode].filter(Boolean).join(', ') || null;

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
            <Text style={typography.screenTitle}>{order.orderNumber}</Text>
            <StatusPill status={order.status} label={prettyStatus(order.status)} />
          </View>
          <Text style={typography.meta}>{dropLine ?? 'Collected at your counter'}</Text>
          <Timeline status={order.status} />
        </Card>

        <View>
          <Text style={styles.groupLabel}>Delivery</Text>
          <GroupedCard>
            {order.promisedEtaMin ? (
              <GroupedRow label="Promised to the customer" value={`${order.promisedEtaMin} min`} />
            ) : null}
            {dropLine ? <GroupedRow label="Drop" value={dropLine} /> : null}
            <GroupedRow
              label="Payment"
              value={order.paymentMethod === 'COD' ? 'Rider collects cash' : 'Paid online'}
              right={
                <StatusPill
                  tone={order.paymentMethod === 'COD' ? 'warning' : 'success'}
                  label={order.paymentMethod === 'COD' ? 'Cash on delivery' : 'Prepaid'}
                />
              }
            />
          </GroupedCard>
        </View>

        <View>
          <Text style={styles.groupLabel}>Pack this</Text>
          <Card>
            {order.items.map((item, index) => (
              <View
                key={`${item.productId}-${item.variantId ?? 'base'}-${index}`}
                style={[styles.item, index > 0 && styles.itemRuled]}
              >
                <View style={styles.qtyChip}>
                  <Text style={styles.qtyText}>{item.quantity}</Text>
                </View>
                <View style={styles.itemBody}>
                  <Text style={typography.cardTitle}>{item.productName}</Text>
                  {item.addOns?.length ? (
                    <Text style={typography.meta}>{item.addOns.map((a) => a.label ?? a).join(', ')}</Text>
                  ) : null}
                  <Text style={typography.meta}>{formatINR(item.unitPrice)} each</Text>
                </View>
                <Text style={typography.body}>{formatINR(mulMoney(item.unitPrice, item.quantity))}</Text>
              </View>
            ))}
            <Divider />
            <KeyValue label="Goods" value={formatINR(goodsTotal)} strong />
            <KeyValue
              label={order.paymentMethod === 'COD' ? 'Rider collects from the customer' : 'Customer already paid'}
              value={formatINR(order.grandTotal)}
            />
          </Card>
        </View>

        {order.instructions ? (
          <View>
            <Text style={styles.groupLabel}>Customer note</Text>
            <Card>
              <Text style={styles.instructions}>“{order.instructions}”</Text>
            </Card>
          </View>
        ) : null}

        {order.status === 'READY' ? (
          <Card style={styles.waiting}>
            <Text style={typography.cardTitle}>Waiting for a rider</Text>
            <Text style={typography.meta}>
              A rider has been called. If none is on shift the order stays in the queue and is handed out as soon as one
              clocks in — nothing is lost.
            </Text>
          </Card>
        ) : null}

        {/* Deliberately here and not in the pinned bar: an irreversible reroute
            should not share an edge with the button tapped every few minutes. */}
        {live ? (
          <View style={styles.escape}>
            <Button label="I can't fulfil this" variant="danger" onPress={reportStockout} disabled={busy} />
            <Text style={styles.escapeNote}>Sends the order to another shop and counts against the item.</Text>
          </View>
        ) : null}
      </ScrollView>

      {step ? (
        <StickyFooter>
          <Button label={step.label} onPress={advance} loading={busy} />
          <Text style={styles.note}>{step.note}</Text>
        </StickyFooter>
      ) : null}
    </View>
  );
}

const STEPS = [
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PREPARING', label: 'Packing' },
  { key: 'READY', label: 'Ready' },
  { key: 'PICKED', label: 'Picked up' },
  { key: 'DELIVERED', label: 'Delivered' }
];

/**
 * Where the order is, and how much of it is the shop's to do.
 *
 * The track is one bar behind the dots, inset to the first and last dot centres
 * (each step is `1/n` wide, so a centre sits at `½/n` from each end), with a
 * fill sized to the progress. That is layout React Native actually honours —
 * the previous per-step `position: absolute; right: -50%` connector was not.
 */
function Timeline({ status }) {
  const index = STEPS.findIndex((s) => s.key === status);
  const inset = `${50 / STEPS.length}%`;
  const progress = index <= 0 ? 0 : (index / (STEPS.length - 1)) * 100;

  return (
    <View style={styles.timeline}>
      <View style={[styles.track, { left: inset, right: inset }]}>
        <View style={[styles.trackFill, { width: `${progress}%` }]} />
      </View>
      {STEPS.map((step, i) => {
        const done = i <= index;
        const current = i === index;
        return (
          <View key={step.key} style={styles.timelineStep}>
            <View style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]} />
            <Text style={[typography.meta, done && styles.stepDone]} numberOfLines={1}>
              {step.label}
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

  head: { gap: spacing.sm },
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

  instructions: { ...typography.body, fontStyle: 'italic' },

  waiting: { backgroundColor: colors.infoSoft, gap: spacing.xs },

  escape: { gap: spacing.sm, marginTop: spacing.sm },
  escapeNote: { ...typography.meta, textAlign: 'center' },
  note: { ...typography.meta, textAlign: 'center' },

  timeline: { flexDirection: 'row', marginTop: spacing.md },
  timelineStep: { flex: 1, alignItems: 'center', gap: spacing.sm },
  track: { position: 'absolute', top: 5, height: 2, backgroundColor: colors.border },
  trackFill: { height: '100%', backgroundColor: colors.accent },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.accent },
  dotCurrent: { borderWidth: 3, borderColor: colors.accentSoft, width: 14, height: 14, borderRadius: 7 },
  stepDone: { color: colors.ink, fontWeight: '600' }
});
