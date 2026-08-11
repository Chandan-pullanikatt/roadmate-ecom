// What RoadMate has paid this rider, what it owes, and how it works it out.
//
// **Nothing on this screen is computed here.** Every figure is a frozen
// `DeliveryJob.riderEarning` column or a `RiderSettlement` row, summed by the
// API. A fee is priced once, inside the delivery transaction, and never
// recomputed — exactly like the commission split, and for the same reason:
// raising the per-km rate next month must not reprice a trip somebody already
// made. If this screen did its own arithmetic it could disagree with the ledger,
// and the rider would be right to believe the screen.
//
// **The rates are shown, deliberately** — which is the opposite of
// `commission_percent`, which appears on no screen anywhere in the platform. The
// distinction is not squeamishness: the commission is a cut the platform takes
// and a live percentage would be the app asserting a number the client has
// revised before. The rates below are *this rider's own pay*, and somebody
// doing piece work is entitled to know how the piece is priced.
//
// ⚠️ The three rates default to 0 until the client's figures are recorded. A
// zero here is honest — it says nobody has set them — and it is three fields on
// the Master settings screen, not a code change.
//
// ⚠️ **This screen is now every rider's, including a shop's own delivery boy.**
// It used to be unreachable for him — the tab was hidden and the endpoint
// answered 403 `EMPLOYED_BY_SHOP` — because RoadMate paid somebody else's
// employee nothing. The client reversed that on 2026-08-09: the platform pays
// every rider the same ₹25 + ₹8/km, so hiding this would conceal money he is
// owed.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  typography,
  Card,
  SectionHeader,
  StatGrid,
  StatTile,
  GroupedCard,
  GroupedRow,
  EmptyState,
  Banner,
  connectionMessage,
  SkeletonTiles,
  SkeletonCard,
  formatINR
} from '@roadmate/ui';
import { useApi } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';

export default function Earnings() {
  const api = useApi();

  const earnings = useResource(useCallback(() => api.getEarnings(), [api]), {
    intervalMs: POLL_MS.earnings
  });

  // ⚠️ The `EMPLOYED_BY_SHOP` branch that used to sit here is gone. The endpoint
  // refused a shop's own delivery boy, because RoadMate paid him nothing; since
  // 2026-08-09 the platform pays every rider the same ₹25 + ₹8/km, so this
  // screen is his as much as anybody's and the 403 no longer exists to handle.

  const data = earnings.data;
  const problem = connectionMessage(earnings.error);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl
          refreshing={earnings.refreshing}
          onRefresh={() => earnings.reload()}
          tintColor={colors.accent}
        />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={() => earnings.reload()} /> : null}

      <View>
        <SectionHeader title="Today" />
        {earnings.loading && !data ? (
          <SkeletonTiles count={3} />
        ) : (
          <StatGrid>
            <StatTile label="Earned" value={formatINR(data?.today?.earned ?? '0.00')} icon="earnings" tone="success" />
            <StatTile label="Deliveries" value={String(data?.today?.deliveries ?? 0)} icon="deliveries" />
            {/* Dead runs are shown, not hidden. The platform pays for them; a
                rider who thinks a wasted trip is unpaid stops reporting them. */}
            <StatTile label="Dead runs" value={String(data?.today?.deadRuns ?? 0)} icon="deadRun" tone="warning" />
          </StatGrid>
        )}
      </View>

      <View>
        <SectionHeader title="Not yet paid out" />
        {earnings.loading && !data ? (
          <SkeletonCard count={1} />
        ) : (
          <Card>
            <Text style={styles.pending}>{formatINR(data?.pending?.total ?? '0.00')}</Text>
            <Text style={typography.meta}>
              {data?.pending?.jobCount
                ? `${data.pending.jobCount} ${
                    data.pending.jobCount === 1 ? 'trip' : 'trips'
                  } waiting for the weekly payout run.`
                : 'Everything you have earned so far has been settled.'}
            </Text>
          </Card>
        )}
      </View>

      <View>
        <SectionHeader title="Paid" />
        {(data?.settlements ?? []).length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing settled yet"
              message="RoadMate settles delivery partners weekly. Your first payout appears here after your first full week."
            />
          </Card>
        ) : (
          <GroupedCard>
            {data.settlements.map((s) => (
              <GroupedRow
                key={s.id}
                label={`${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`}
                sublabel={[
                  `${s.deliveries} ${s.deliveries === 1 ? 'delivery' : 'deliveries'}`,
                  s.deadRuns ? `${s.deadRuns} dead ${s.deadRuns === 1 ? 'run' : 'runs'}` : null,
                  s.utrNumber ? `UTR ${s.utrNumber}` : null
                ]
                  .filter(Boolean)
                  .join(' • ')}
                value={formatINR(s.netPayable)}
                tone={s.status === 'Settled' || s.paidAt ? 'success' : 'warning'}
              />
            ))}
          </GroupedCard>
        )}
      </View>

      <View>
        <SectionHeader title="How your pay is worked out" />
        <Card>
          <Text style={typography.body}>
            {formatINR(data?.rates?.baseFee ?? '0.00')} for every delivery, with the first{' '}
            {data?.rates?.freeKm ?? 0} km included, then {formatINR(data?.rates?.perKmFee ?? '0.00')} for
            each kilometre after that.
          </Text>
          <Text style={[typography.meta, styles.ratesNote]}>
            Worked out once, when you mark the delivery done, and never changed afterwards — so a later
            change to these rates cannot alter a trip you have already made. A dead run pays the same as
            a delivery: you made the trip.
          </Text>
        </Card>
      </View>
    </ScrollView>
  );
}

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}`;
};

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  pending: { fontSize: 28, fontWeight: '800', color: colors.ink },
  ratesNote: { marginTop: spacing.sm, lineHeight: 18 }
});
