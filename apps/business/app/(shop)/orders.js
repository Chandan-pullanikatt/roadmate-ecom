// The screen this app exists for: incoming consumer orders on a 60-second
// window, and the orders already being packed.
//
// Polished in-house against HANDOFF §5 and `designs/Partner.png` (2026-08-07).
// The visual pass changed how this reads, not how it behaves — see the rules
// below, all of which survived it unchanged.
//
// The one rule the interaction has to get right:
//
//   **ACCEPT IS A CLAIM, NOT AN UPDATE.** The backend accepts with a conditional
//   `updateMany` on `status = OFFERED AND expiresAt >= now`. A 409 means the
//   sweeper already rerouted this order to another shop — it is gone. The UI
//   says "this order moved on" and refreshes. It never retries, and it never
//   shows a generic error, because both would suggest the shop can still win
//   something it cannot. (HANDOFF §1.5–1.6.)
//
// The countdown is likewise advisory. It runs off the server's
// `secondsRemaining` *duration*, so a wrong phone clock cannot skew it, and when
// it hits zero it re-asks the server rather than deciding the offer is dead.
//
// What the polish added, and why each earns its place:
//
//   • **The offer is the loudest thing on the screen.** It was a white card in a
//     stack of white cards; it is now accent-edged with the countdown in a
//     tinted header. A shop glancing at a phone on a counter has to be able to
//     tell "something needs me now" from "here is a list" without reading.
//   • **A connection banner.** `useResource` keeps the last good data when a
//     poll fails, and no screen was rendering that error — so a shop could watch
//     a countdown that had quietly stopped being connected to anything.
//   • **Skeletons instead of a blank first paint**, because a blank offers list
//     and a genuinely empty one looked identical.
//   • **In-progress rows are `OrderCard`s**, the shape the designs actually draw:
//     money on its own line, bold, with the affordance opposite it.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  SectionHeader,
  OrderCard,
  EmptyState,
  Button,
  Countdown,
  Banner,
  connectionMessage,
  SkeletonCard,
  formatINR,
  prettyStatus
} from '@roadmate/ui';
import { useApi } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';

const IN_PROGRESS = ['ACCEPTED', 'PREPARING', 'READY', 'PICKED'];

export default function Orders() {
  const api = useApi();
  const router = useRouter();

  const offers = useResource(useCallback(() => api.listOffers(), [api]), { intervalMs: POLL_MS.offers });
  const orders = useResource(useCallback(() => api.listOrders(), [api]), { intervalMs: POLL_MS.orders });

  const offerList = offers.data?.offers ?? [];
  const orderList = (orders.data?.orders ?? []).filter((o) => IN_PROGRESS.includes(o.status));

  const reloadAll = () => {
    offers.reload();
    orders.reload();
  };

  // Only worth saying once, and the offers poll is the one that matters here —
  // it is the fast one, so it notices first.
  const problem = connectionMessage(offers.error ?? orders.error);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={offers.refreshing} onRefresh={reloadAll} tintColor={colors.accent} />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={reloadAll} /> : null}

      <View>
        <SectionHeader
          title="Waiting for your answer"
          action={offerList.length ? `${offerList.length}` : undefined}
        />
        {offers.loading && !offers.data ? (
          <SkeletonCard count={3} />
        ) : offerList.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing waiting"
              message="New customer orders appear here with a countdown. Answer before it runs out or the order goes to another shop."
            />
          </Card>
        ) : (
          offerList.map((offer) => (
            <OfferCard
              key={offer.attemptId}
              offer={offer}
              api={api}
              offers={offers}
              onAccepted={() => {
                orders.reload();
                router.push(`/(shop)/order/${offer.orderId}`);
              }}
            />
          ))
        )}
      </View>

      <View>
        <SectionHeader title="In progress" />
        {orders.loading && !orders.data ? (
          <SkeletonCard count={2} />
        ) : orderList.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing being packed"
              message="Orders you accept show up here until the rider collects them."
            />
          </Card>
        ) : (
          <View style={styles.stack}>
            {orderList.map((order) => (
              <OrderCard
                key={order.id}
                title={order.orderNumber}
                meta={[
                  `${order.items.length} item${order.items.length === 1 ? '' : 's'}`,
                  order.dropArea?.landmark ?? order.dropArea?.city,
                  order.paymentMethod === 'COD' ? 'Cash on delivery' : 'Paid'
                ]
                  .filter(Boolean)
                  .join(' • ')}
                status={order.status}
                statusLabel={prettyStatus(order.status)}
                amount={formatINR(order.grandTotal)}
                action={order.status === 'READY' ? 'Awaiting rider' : 'Details'}
                onPress={() => router.push(`/(shop)/order/${order.id}`)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function OfferCard({ offer, api, offers, onAccepted }) {
  const [busy, setBusy] = useState(null);

  /**
   * Every answer to an offer is a race the shop can lose. `answer` is the one
   * place that knows what losing looks like, so no individual button has to.
   *
   * `withPause` is not optional: without it the 5-second offers poll can land
   * mid-accept and put the order back in the list it just left.
   */
  const answer = (verb, action) =>
    offers.withPause(async () => {
      setBusy(verb);
      try {
        await action();
        return true;
      } catch (error) {
        if (error.isConflict) {
          // The sweeper got there first. Not an error the shop caused, and not
          // something to try again — the order is on someone else's screen now.
          Alert.alert('This order moved on', 'The window closed and it went to another shop.');
        } else if (error.isNetwork) {
          Alert.alert('No connection', 'Could not reach RoadMate. Check the connection and try again.');
        } else {
          Alert.alert('Could not do that', error.message);
        }
        return false;
      } finally {
        setBusy(null);
      }
    });

  const accept = async () => {
    const won = await answer('accept', () => api.acceptOffer(offer.orderId));
    if (won) onAccepted?.();
  };

  const reject = () =>
    Alert.alert('Decline this order?', 'It goes straight to the next shop — the customer does not wait out the timer.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: () => answer('reject', () => api.rejectOffer(offer.orderId, 'Declined from the shop app'))
      }
    ]);

  const itemCount = offer.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <View style={styles.offer}>
      {/* The tinted header is the whole point of the redesign: the countdown is
          the most time-critical element in the product and it now owns the top
          of the card rather than sharing a white surface with everything else.
          The component itself is untouched — it still anchors on elapsed wall
          time and still re-asks the server at zero. */}
      <View style={styles.offerTimer}>
        <Countdown seconds={offer.secondsRemaining} onExpire={() => offers.reload({ silent: true })} />
      </View>

      <View style={styles.offerBody}>
        <View style={styles.offerHead}>
          <View style={styles.offerHeadText}>
            <Text style={styles.offerNumber}>{offer.orderNumber}</Text>
            <Text style={typography.meta}>
              {[
                `${itemCount} item${itemCount === 1 ? '' : 's'}`,
                offer.dropArea?.landmark ?? offer.dropArea?.city,
                offer.promisedEtaMin ? `${offer.promisedEtaMin} min promise` : null
              ]
                .filter(Boolean)
                .join(' • ')}
            </Text>
          </View>
          {/* COD is amber because it is the case that needs the shop's
              attention — the rider will be collecting cash at the door. */}
          <View style={[styles.payTag, offer.paymentMethod === 'COD' ? styles.payCod : styles.payPaid]}>
            <Text style={[styles.payText, { color: offer.paymentMethod === 'COD' ? colors.warning : colors.success }]}>
              {offer.paymentMethod === 'COD' ? 'Cash on delivery' : 'Paid online'}
            </Text>
          </View>
        </View>

        <View style={styles.items}>
          {offer.items.map((item, index) => (
            <View key={`${item.productId}-${item.variantId ?? 'base'}-${index}`} style={styles.item}>
              <View style={styles.qtyChip}>
                <Text style={styles.qtyText}>{item.quantity}</Text>
              </View>
              <Text style={[typography.body, styles.itemName]} numberOfLines={2}>
                {item.productName}
              </Text>
              <Text style={typography.meta}>{formatINR(item.unitPrice)}</Text>
            </View>
          ))}
        </View>

        {offer.instructions ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteLabel}>Customer note</Text>
            <Text style={styles.noteText}>“{offer.instructions}”</Text>
          </View>
        ) : null}

        <View style={styles.totalRow}>
          <Text style={typography.body}>Order total</Text>
          {/* A fixed-2 string from the API, formatted as a string. Never parsed —
              B2C money is Decimal all the way to the screen. */}
          <Text style={styles.total}>{formatINR(offer.grandTotal)}</Text>
        </View>

        <View style={styles.actions}>
          <Button
            label="Decline"
            variant="danger"
            onPress={reject}
            loading={busy === 'reject'}
            disabled={busy !== null}
            style={styles.action}
          />
          <Button
            label="Accept"
            onPress={accept}
            loading={busy === 'accept'}
            disabled={busy !== null}
            style={styles.action}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  stack: { gap: spacing.md },

  offer: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    overflow: 'hidden',
    marginBottom: spacing.md,
    shadowColor: '#0B1220',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3
  },
  offerTimer: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  offerBody: { padding: spacing.lg, gap: spacing.md },

  offerHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  offerHeadText: { flex: 1, gap: 2 },
  offerNumber: { fontSize: 17, fontWeight: '700', color: colors.ink },

  payTag: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  payCod: { backgroundColor: colors.warningSoft },
  payPaid: { backgroundColor: colors.successSoft },
  payText: { fontSize: 11, fontWeight: '700' },

  items: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qtyChip: {
    minWidth: 26,
    height: 24,
    borderRadius: radius.sm,
    backgroundColor: colors.page,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  qtyText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  itemName: { flex: 1 },

  noteBox: { backgroundColor: colors.page, borderRadius: radius.sm, padding: spacing.md, gap: 2 },
  noteLabel: { ...typography.sku },
  noteText: { ...typography.body, fontStyle: 'italic' },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md
  },
  total: { fontSize: 20, fontWeight: '800', color: colors.ink },

  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 }
});
