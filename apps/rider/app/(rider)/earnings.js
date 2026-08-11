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
// ⚠️ The three rates default to 0 until the client's figures are recorded with
// `npm run config:apply`. A zero is honest — it says nobody has set them — but on
// **this** screen a zero is also indistinguishable from "RoadMate pays you
// nothing", which is the single worst sentence this app could show a rider. So
// the rate strip below says so explicitly rather than rendering ₹0.00 as fact.
//
// ── THE LAYOUT, AND WHY IT CHANGED (2026-08-11) ─────────────────────────────
//
// It used to be four sections of equal weight, each a `SectionHeader` over a
// `Card`, with the **largest number on the screen being "Not yet paid out"** —
// the figure a rider cares about least, set in 28 pt, while what he actually
// earned today sat in a small tile above it. The hierarchy was upside down.
//
// Now: today's pay is the hero, in the same accent wash the shift switch uses, so
// "what am I making" reads the same way in both places. Everything else is
// support beneath it.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  shadow,
  shadowLift,
  Card,
  SectionHeader,
  GroupedCard,
  GroupedRow,
  Gradient,
  Icon,
  EmptyState,
  Banner,
  connectionMessage,
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

  const data = earnings.data;
  const problem = connectionMessage(earnings.error);
  const loading = earnings.loading && !data;

  const today = data?.today ?? {};
  const rates = data?.rates ?? {};
  // The rates are a set: either the client's figures are recorded or none are.
  // Treating "all three zero" as unset is what stops the strip stating ₹0.00 per
  // delivery as though it were the deal.
  const ratesSet = Number(rates.baseFee ?? 0) > 0 || Number(rates.perKmFee ?? 0) > 0;
  const settlements = data?.settlements ?? [];

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

      {/* ── Today, as the hero ──────────────────────────────────────────────
          One number, large, on the accent wash. The two supporting counts sit
          inside the same card rather than beside it as separate tiles: they are
          *what produced* this figure, and three sibling tiles gave a count of
          dead runs the same weight as the money. */}
      {loading ? (
        <SkeletonCard count={1} />
      ) : (
        <View style={styles.heroWrap}>
          <Gradient
            colors={[colors.accentDim, colors.accent]}
            direction="horizontal"
            radius={radius.md}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Earned today</Text>
            <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>
              {formatINR(today.earned ?? '0.00')}
            </Text>
            <View style={styles.heroFooter}>
              <HeroStat icon="deliveries" value={today.deliveries ?? 0} noun="delivery" plural="deliveries" />
              {/* Dead runs are shown, not hidden. The platform pays for them; a
                  rider who thinks a wasted trip is unpaid stops reporting them. */}
              <HeroStat icon="deadRun" value={today.deadRuns ?? 0} noun="dead run" plural="dead runs" />
            </View>
          </View>
        </View>
      )}

      {/* Owed but not yet transferred. Secondary to today's pay, and its own
          sentence carries the only thing a rider actually wants from it: when. */}
      {loading ? null : (
        <Card style={styles.pendingCard}>
          <View style={styles.pendingRow}>
            <View style={styles.pendingText}>
              <Text style={typography.meta}>Not yet paid out</Text>
              <Text style={styles.pendingValue}>{formatINR(data?.pending?.total ?? '0.00')}</Text>
            </View>
            <View style={styles.pendingBadge}>
              <Icon name="pending" size={18} color={colors.info} />
            </View>
          </View>
          <Text style={typography.meta}>
            {data?.pending?.jobCount
              ? `${data.pending.jobCount} ${
                  data.pending.jobCount === 1 ? 'trip' : 'trips'
                } waiting for the weekly payout run.`
              : 'Everything you have earned so far has been settled.'}
          </Text>
        </Card>
      )}

      <View>
        <SectionHeader title="Paid" />
        {settlements.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing settled yet"
              message="RoadMate settles delivery partners weekly. Your first payout appears here after your first full week."
            />
          </Card>
        ) : (
          <GroupedCard>
            {settlements.map((s) => (
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

      {/* ── The rates ───────────────────────────────────────────────────────
          Three figures in a row rather than a sentence. A rider checking what he
          is owed is scanning, not reading, and "₹25 · 2 km · ₹8/km" answers the
          question in one glance where the paragraph took four lines. */}
      <View>
        <SectionHeader title="How your pay is worked out" />
        {ratesSet ? (
          <>
            <View style={styles.rateStrip}>
              <RateCell value={formatINR(rates.baseFee ?? '0.00')} label="every delivery" />
              <View style={styles.rateDivider} />
              <RateCell value={`${rates.freeKm ?? 0} km`} label="included" />
              <View style={styles.rateDivider} />
              <RateCell value={formatINR(rates.perKmFee ?? '0.00')} label="per km after" />
            </View>
            <Text style={styles.ratesNote}>
              Worked out once, when you mark the delivery done, and never changed afterwards — so a
              later change to these rates cannot alter a trip you have already made. A dead run pays
              the same as a delivery: you made the trip.
            </Text>
          </>
        ) : (
          // ⚠️ Never render unset rates as ₹0.00. "You are paid ₹0.00 for every
          // delivery" is a sentence this app must not be capable of showing.
          <Banner
            tone="info"
            message="RoadMate has not published the delivery rates for your area yet. Your completed trips are still being recorded and will be paid."
          />
        )}
      </View>
    </ScrollView>
  );
}

/** A count inside the hero, on the accent wash. */
function HeroStat({ icon, value, noun, plural }) {
  return (
    <View style={styles.heroStat}>
      <Icon name={icon} size={15} color={colors.ink} />
      <Text style={styles.heroStatText}>
        {value} {value === 1 ? noun : plural}
      </Text>
    </View>
  );
}

function RateCell({ value, label }) {
  return (
    <View style={styles.rateCell}>
      <Text style={styles.rateValue} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.rateLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  // ⚠️ No `toLocaleString` options — Hermes only has full `Intl` where the
  // platform's ICU is available, and a build without it formats some other way:
  // wrong-looking rather than broken, and therefore never reported (HANDOFF §6).
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },

  heroWrap: { borderRadius: radius.md, ...shadowLift },
  hero: { padding: spacing.xl, borderRadius: radius.md, gap: spacing.xs },
  heroLabel: { fontSize: 13, fontWeight: '700', color: '#4A4123', letterSpacing: 0.3 },
  // The one number this screen exists for. 40 pt against the old 28 pt that was
  // spent on "not yet paid out".
  heroValue: { fontSize: 40, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  heroFooter: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroStatText: { fontSize: 13, fontWeight: '600', color: '#4A4123' },

  pendingCard: { gap: spacing.sm },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pendingText: { flex: 1, gap: 2 },
  pendingValue: { fontSize: 24, fontWeight: '800', color: colors.ink },
  pendingBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },

  rateStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    ...shadow
  },
  rateCell: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs },
  rateValue: { fontSize: 18, fontWeight: '800', color: colors.ink },
  rateLabel: { ...typography.meta, textAlign: 'center' },
  rateDivider: { width: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  ratesNote: { ...typography.meta, lineHeight: 18, marginTop: spacing.md }
});
