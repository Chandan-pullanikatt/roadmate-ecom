// The partner's own subscription: what the free trial is, and what is owed
// after it. HANDOFF §7ter.
//
// A root-level route rather than a screen inside `(shop)` or `(exec)`, because
// the three billable roles span both sections — a shop and a distributor see
// exactly the same thing here, and duplicating it is how the two copies drift.
// Reached from Profile in both sections, never as a tab: this is a screen a
// partner opens twice a month, not one they live in.
//
// ⚠️ Every amount here is a fixed-2 **string** off the wire (`formatINR`, never
// `formatAmount` and never `parseFloat`) — subscriptions are Decimal on the
// server, like the rest of the B2C money, unlike the B2B floats this app also
// shows.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert, Linking, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import {
  colors,
  spacing,
  typography,
  formatINR,
  Card,
  Divider,
  KeyValue,
  Button,
  Banner,
  connectionMessage,
  StatusPill,
  EmptyState,
  SkeletonCard
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi } from '../src/session.js';
import {
  PHASE_LABEL,
  PHASE_TONE,
  INVOICE_TONE,
  formatDate,
  invoicePeriod
} from '../src/billing.js';

export default function Subscription() {
  const api = useApi();
  const billing = useResource(useCallback(() => api.getBilling(), [api]));
  const data = billing.data;

  return (
    <>
      <Stack.Screen options={{ title: 'Subscription' }} />
      <ScrollView contentContainerStyle={styles.wrap}>
        {billing.error ? <Banner message={connectionMessage(billing.error)} tone="danger" /> : null}

        {!data ? (
          <SkeletonCard count={3} />
        ) : data.billable === false ? (
          // A REGIONAL partner is paid a share of the commission pool and a
          // rider is paid per delivery. Neither is billed, and saying so is
          // better than an empty screen that looks broken.
          <EmptyState
            title="No subscription"
            message="Your role isn’t billed a monthly fee. What you earn is settled to you instead."
          />
        ) : (
          <>
            <StandingCard data={data} />
            <InvoiceList api={api} billing={billing} data={data} />
          </>
        )}
      </ScrollView>
    </>
  );
}

function StandingCard({ data }) {
  return (
    <Card>
      <View style={styles.headRow}>
        <Text style={typography.sectionTitle}>Your plan</Text>
        <StatusPill label={PHASE_LABEL[data.phase] ?? data.phase} tone={PHASE_TONE[data.phase]} />
      </View>
      <Divider />

      {!data.trialStartKnown ? (
        // Not an error, and not something to render as "—". This partner was
        // approved before RoadMate recorded approval dates, so there is no date
        // to count three months from and nothing is being billed.
        <Text style={typography.meta}>
          We don’t have your approval date on file, so your trial can’t be dated and nothing is being
          billed. RoadMate will be in touch to set it — you don’t owe anything today.
        </Text>
      ) : (
        <>
          <KeyValue
            label="Monthly fee"
            value={data.feeConfigured ? `${formatINR(data.monthlyFee)}/month` : 'Not set'}
            strong
          />
          <KeyValue label="Free trial started" value={formatDate(data.trialStartedAt)} />
          <KeyValue
            label={data.phase === 'TRIAL' ? 'Free until' : 'Free trial ended'}
            value={formatDate(data.trialEndsAt)}
          />
          {data.phase === 'TRIAL' ? (
            <Text style={typography.meta}>
              {data.trialDaysLeft > 0
                ? `${data.trialDaysLeft} day${data.trialDaysLeft === 1 ? '' : 's'} left. `
                : 'Your trial ends today. '}
              Your first invoice covers the month starting {formatDate(data.billingAnchorAt)}.
            </Text>
          ) : null}
          {data.cancelledAt ? (
            <>
              <Divider />
              <KeyValue label="Cancelled" value={formatDate(data.cancelledAt)} />
              <Text style={typography.meta}>
                No new invoices will be raised. Anything already invoiced is still payable.
              </Text>
            </>
          ) : null}
          {!data.feeConfigured ? (
            <Text style={typography.meta}>
              RoadMate hasn’t set a fee for your account type yet, so you aren’t being invoiced.
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

function InvoiceList({ api, billing, data }) {
  const [busyId, setBusyId] = useState(null);

  // Every mutating tap goes through `withPause`, or the 30-second poll lands
  // mid-action and re-renders the list from pre-action data.
  const pay = (invoice) =>
    billing.withPause(async () => {
      setBusyId(invoice.id);
      try {
        const res = await api.createPayLink(invoice.id);
        const url = res.invoice?.paymentLinkUrl;
        // `live: false` means the server has no Razorpay credentials, so the
        // URL is a stub nobody could pay. Sending someone to a dead link is
        // worse than telling them it isn't ready — the same rule the Customer
        // app applies to prepaid checkout.
        if (res.live === false) {
          Alert.alert(
            'Online payment isn’t live yet',
            'RoadMate hasn’t finished setting up card payments. Pay by bank transfer and it will be recorded against this invoice.'
          );
          return;
        }
        if (url) await Linking.openURL(url);
      } catch (error) {
        Alert.alert('Could not open the payment link', error.message);
      } finally {
        setBusyId(null);
      }
    });

  if (!data.invoices.length) {
    return (
      <Card>
        <Text style={typography.sectionTitle}>Invoices</Text>
        <Divider />
        <Text style={typography.meta}>
          Nothing invoiced yet. Your first bill appears when your free trial ends.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.headRow}>
        <Text style={typography.sectionTitle}>Invoices</Text>
        {Number(data.amountDue) > 0 ? (
          <Text style={[typography.body, styles.due]}>{formatINR(data.amountDue)} due</Text>
        ) : null}
      </View>

      {data.invoices.map((invoice) => (
        <View key={invoice.id} style={styles.invoice}>
          <Divider />
          <View style={styles.invoiceHead}>
            <View style={styles.invoiceText}>
              <Text style={typography.body}>{invoicePeriod(invoice)}</Text>
              <Text style={typography.meta}>{invoice.number}</Text>
            </View>
            <StatusPill label={invoice.status === 'DUE' ? 'Unpaid' : invoice.status === 'PAID' ? 'Paid' : 'Cancelled'} tone={INVOICE_TONE[invoice.status]} />
          </View>

          <View style={styles.invoiceHead}>
            <Text style={[typography.sectionTitle, styles.amount]}>{formatINR(invoice.amount)}</Text>
            <Text style={typography.meta}>
              {invoice.status === 'PAID'
                ? `Paid ${formatDate(invoice.paidAt)}`
                : invoice.status === 'VOID'
                  ? invoice.voidNote || 'Cancelled'
                  : `Due ${formatDate(invoice.dueAt)}`}
            </Text>
          </View>

          {invoice.status === 'DUE' ? (
            <Button
              label={invoice.paymentLinkUrl ? 'Open payment link' : 'Pay this invoice'}
              variant="secondary"
              loading={busyId === invoice.id}
              onPress={() => pay(invoice)}
            />
          ) : null}
        </View>
      ))}

      <Divider />
      <Text style={typography.meta}>
        Paid by bank transfer? It’s recorded against the invoice once RoadMate matches the payment —
        there’s nothing to do here.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  due: { color: colors.warning, fontWeight: '700' },
  invoice: { gap: spacing.sm },
  invoiceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  invoiceText: { flex: 1, gap: 2 },
  amount: { fontVariant: ['tabular-nums'] }
});
