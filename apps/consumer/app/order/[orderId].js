// One order, watched.
//
// **Polling, every 10 seconds, deliberately** (PLAN §5). An order climbs seven
// rungs with no push behind it yet, and a customer with the screen open should
// see each one land. Sockets are the upgrade path *if this visibly fails* — one
// endpoint every ten seconds is a load nothing here notices, and a socket per
// open order is a second connection lifecycle to get right for a screen that is
// open for twenty minutes a week.
//
// Four states this screen exists to render honestly:
//
//   • **Rerouted.** More than one `FulfilmentAttempt` means a shop did not take
//     it and the platform moved on to the next (HANDOFF §3). The customer is
//     told that we kept trying — never *which* shop declined, because naming a
//     shop that said no is a reputation claim the platform has no business
//     making from a timeout.
//   • **Cancelled.** Either the customer's shops all ran out, or a pharmacist
//     rejected the prescription. The reason is on the order and is shown.
//   • **Waiting at PLACED.** Two independent gates — payment and prescription —
//     and either can be the one outstanding, so the screen names the one that
//     is (see `blockedReason`).
//   • **A voucher.** No rider, no ladder, no address: what was bought *is* the
//     code, and the screen becomes the code.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  SectionHeader,
  StatusPill,
  KeyValue,
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
import { openPayment } from '../../src/payment.js';
import {
  DELIVERY_LADDER,
  ladderIndex,
  stageTitle,
  stageMessage,
  isLive,
  rerouteCount,
  blockedReason,
  etaText,
  formatAddress,
  formatWhen,
  formatDate
} from '../../src/order.js';
import {
  useUploadsAvailable,
  attachPrescription,
  uploadProblem
} from '../../src/prescription.js';

export default function OrderScreen() {
  const { orderId } = useLocalSearchParams();
  const api = useApi();
  const router = useRouter();

  // Polling stops once the order is finished. A delivered or cancelled order
  // will never change again, and a phone left face-up on that screen should not
  // keep asking every ten seconds until the battery is flat.
  const [settled, setSettled] = React.useState(false);

  const resource = useResource(useCallback(() => api.getOrder(orderId), [api, orderId]), {
    intervalMs: settled ? undefined : POLL_MS.tracking,
    deps: [orderId],
    cacheKey: 'order',
    // Deliberately a minute rather than the five-minute default. Opening the
    // order you were just watching should paint the rung it was on instead of a
    // skeleton — but this is the one screen where the answer genuinely goes out
    // of date on its own, so anything older than a poll or two is not worth
    // showing first.
    cacheMaxAgeMs: 60_000
  });

  const order = resource.data?.order ?? null;
  const problem = connectionMessage(resource.error);
  const voucher = (order?.vouchers ?? [])[0] ?? null;
  const blocked = blockedReason(order);
  const reroutes = rerouteCount(order);

  React.useEffect(() => {
    if (order && !isLive(order)) setSettled(true);
  }, [order]);

  // Prescription upload (2026-08-09). Probed rather than assumed: on a
  // deployment without file storage there is no camera button at all, and the
  // banner alone says a pharmacist will check the order.
  const uploadsAvailable = useUploadsAvailable(api, order?.id);
  const [uploading, setUploading] = useState(null);

  // Paying (2026-08-12). `withPause` for the same reason the upload uses it: the
  // customer is about to leave for the browser, and a poll landing mid-hand-off
  // would re-render the screen underneath them. It resumes when they come back,
  // which is exactly when the webhook is worth watching for.
  const [paying, setPaying] = useState(false);
  const pay = () =>
    resource.withPause(async () => {
      setPaying(true);
      try {
        await openPayment(api, order.id);
      } finally {
        setPaying(false);
      }
    });

  const addPrescription = (fromLibrary) =>
    resource.withPause(async () => {
      setUploading(fromLibrary ? 'library' : 'camera');
      try {
        const attached = await attachPrescription(api, { orderId: order.id, fromLibrary });
        if (attached) {
          Alert.alert(
            'Prescription sent',
            'A pharmacist will check it. Your order stays here until they do — no shop has been asked to pack it yet.'
          );
          // The banner and the gate both come from the order, so the screen has
          // to re-read it rather than assume what the server now thinks.
          await resource.reload();
        }
      } catch (error) {
        Alert.alert('Could not attach it', uploadProblem(error));
      } finally {
        setUploading(null);
      }
    });

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl
          refreshing={resource.refreshing}
          onRefresh={() => resource.reload()}
          tintColor={colors.accent}
        />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={() => resource.reload()} /> : null}

      {!order ? (
        resource.loading ? (
          <SkeletonCard count={4} />
        ) : (
          <Card>
            <EmptyState title="Order not found" message="It may belong to another account." />
          </Card>
        )
      ) : (
        <>
          <Card style={styles.head}>
            <View style={styles.headRow}>
              <View style={styles.headText}>
                <Text style={typography.sku}>{order.orderNumber}</Text>
                <Text style={typography.screenTitle}>{stageTitle(order.status)}</Text>
                <Text style={typography.meta}>
                  {stageMessage(order.status)}
                  {etaText(order) ? ` · ${etaText(order)}` : ''}
                </Text>
              </View>
              <StatusPill status={order.status} />
            </View>

            {blocked ? <Banner tone={blocked.tone} message={blocked.message} /> : null}

            {/* Pay, from the order screen (2026-08-12). This is the *only*
                durable way to pay an order: checkout opens the same page, but a
                browser can be dismissed, a UPI app can be interrupted, and a
                phone can die between the two — after which the order sits
                unpaid, unrouted, and until now with nothing on screen to finish
                it. Nothing here trusts the browser: the button re-opens the same
                gateway order (the endpoint is idempotent), and this screen keeps
                polling for the webhook either way. */}
            {order.requiresPayment && order.paymentMethod === 'PREPAID' && order.status === 'PLACED' ? (
              <Button
                label={`Pay ${formatINR(order.grandTotal)}`}
                loading={paying}
                disabled={paying}
                onPress={pay}
              />
            ) : null}

            {/* The upload itself. Only when the order is actually waiting on
                one and the server has storage — never a camera button that
                cannot reach anywhere. */}
            {blocked?.needsUpload && uploadsAvailable ? (
              <View style={styles.rxActions}>
                <Button
                  label="Photograph it"
                  onPress={() => addPrescription(false)}
                  loading={uploading === 'camera'}
                  disabled={uploading !== null}
                  style={styles.rxAction}
                />
                <Button
                  label="Choose a photo"
                  variant="ghost"
                  onPress={() => addPrescription(true)}
                  loading={uploading === 'library'}
                  disabled={uploading !== null}
                  style={styles.rxAction}
                />
              </View>
            ) : null}

            {order.status === 'CANCELLED' ? (
              <Banner
                tone="danger"
                message={
                  order.cancelReason ||
                  'This order was cancelled. Anything you paid is refunded to the same account.'
                }
              />
            ) : null}

            {reroutes > 0 && isLive(order) ? (
              <Banner
                tone="info"
                message={
                  reroutes === 1
                    ? 'The first shop could not take this order, so we moved it to the next one nearby.'
                    : `We have tried ${reroutes + 1} shops for this order and are still going.`
                }
              />
            ) : null}
          </Card>

          {/* The ladder. Voucher orders never climb it, so they do not draw it. */}
          {voucher ? null : (
            <Card>
              <SectionHeader title="Progress" />
              {DELIVERY_LADDER.map((rung, index) => {
                const current = ladderIndex(order.status);
                const done = order.status !== 'CANCELLED' && index <= current && current >= 0;
                const isNow = index === current;
                return (
                  <View key={rung} style={styles.step}>
                    <View style={[styles.dot, done && styles.dotDone, isNow && styles.dotNow]} />
                    <Text
                      style={[
                        typography.body,
                        !done && { color: colors.inkFaint },
                        isNow && styles.stepNow
                      ]}
                    >
                      {stageTitle(rung)}
                    </Text>
                  </View>
                );
              })}
              {order.status === 'CANCELLED' ? (
                <Text style={styles.cancelledNote}>This order stopped before it was delivered.</Text>
              ) : null}
            </Card>
          )}

          {/* The door handshake (2026-08-13).
              The rider's screen says "ask the customer for the 4-digit code in
              their app" — and until today there was no such code in this app,
              so the last step of every delivery had nothing to complete it.
              The server sends `deliveryCode` only while a rider is actually
              carrying the order, so this appears when somebody is about to ask
              for it and disappears once it is spent. */}
          {order.deliveryCode ? (
            <Card style={styles.codeCard}>
              <SectionHeader title="Your delivery code" />
              <Text style={styles.code} selectable>
                {order.deliveryCode}
              </Text>
              <Text style={typography.meta}>
                Read this out to your delivery partner at the door. It is how the order is
                confirmed — don't share it before they arrive.
              </Text>
            </Card>
          ) : null}

          {/* The membership itself. The code is the product. */}
          {voucher ? (
            <Card style={styles.voucher}>
              <SectionHeader title="Your membership" />
              <Text style={styles.voucherCode} selectable>
                {voucher.code}
              </Text>
              <Text style={typography.meta}>
                {voucher.isRedeemed
                  ? `Used on ${formatDate(voucher.redeemedAt)}`
                  : `Valid till ${formatDate(voucher.validTo)}`}
              </Text>
              {/* No QR image is drawn, on purpose: the shop's own app redeems by
                  *looking the code up* (`GET /api/shop/vouchers/:code`) and has
                  no scanner. A QR nobody scans is decoration that implies a flow
                  that does not exist. `qrPayload` is on the record for when one
                  does. */}
              <Text style={typography.meta}>
                Show this code at the counter — the shop types it into their RoadMate app.
              </Text>
            </Card>
          ) : null}

          {order.shop ? (
            <Card>
              <SectionHeader title="Shop" />
              <Text style={typography.cardTitle}>{order.shop.name}</Text>
              {order.shop.distanceKm != null ? (
                <Text style={typography.meta}>{order.shop.distanceKm} km away</Text>
              ) : null}
            </Card>
          ) : null}

          {order.address ? (
            <Card>
              <SectionHeader title="Delivering to" />
              <Text style={typography.cardTitle}>{order.address.label}</Text>
              <Text style={typography.meta}>{formatAddress(order.address)}</Text>
              {order.instructions ? <Text style={typography.meta}>“{order.instructions}”</Text> : null}
            </Card>
          ) : null}

          <Card>
            <SectionHeader title="Bill" />
            {order.items.map((item) => (
              <KeyValue
                key={item.id}
                label={`${item.quantity} × ${item.productName}`}
                value={formatINR(item.lineTotal)}
              />
            ))}
            <View style={styles.rule} />
            <KeyValue label="Subtotal" value={formatINR(order.subtotal)} />
            {order.discountAmount !== '0.00' ? (
              <KeyValue label="Offer" value={`− ${formatINR(order.discountAmount)}`} />
            ) : null}
            <KeyValue label="Tax" value={formatINR(order.taxAmount)} />
            {order.address ? <KeyValue label="Delivery" value={formatINR(order.deliveryFee)} /> : null}
            {order.tipAmount !== '0.00' ? <KeyValue label="Tip" value={formatINR(order.tipAmount)} /> : null}
            <View style={styles.rule} />
            <KeyValue label="Total" value={formatINR(order.grandTotal)} strong />
            <Text style={typography.meta}>
              {order.paymentMethod === 'COD'
                ? order.status === 'DELIVERED'
                  ? 'Paid in cash on delivery.'
                  : 'Pay your delivery partner in cash at the door.'
                : order.requiresPayment
                  ? 'Waiting for your payment to be confirmed.'
                  : 'Paid online.'}
            </Text>
            <Text style={typography.meta}>Placed {formatWhen(order.placedAt)}</Text>
          </Card>

          <Button label="Back to orders" variant="secondary" onPress={() => router.replace('/(tabs)/orders')} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  head: { gap: spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  rxActions: { flexDirection: 'row', gap: spacing.md },
  rxAction: { flex: 1 },

  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.success },
  dotNow: { backgroundColor: colors.accent, width: 14, height: 14, borderRadius: 7 },
  stepNow: { fontWeight: '700' },
  cancelledNote: { ...typography.meta, color: colors.danger, marginTop: spacing.sm },

  voucher: { gap: spacing.sm, alignItems: 'center' },
  voucherCode: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ink,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    textAlign: 'center'
  },

  // The same treatment as the voucher code, and on purpose: both are "a number
  // you read out to somebody", and a customer who has seen one recognises the
  // other. Wider tracking, because four digits read one at a time.
  codeCard: { gap: spacing.sm, alignItems: 'center' },
  code: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 8,
    color: colors.ink,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    textAlign: 'center'
  },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm }
});
