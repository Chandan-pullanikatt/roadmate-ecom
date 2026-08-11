// The shift screen — the first thing a rider opens and the last thing they
// touch before going home.
//
// One decision shapes the whole screen: **the shift switch is the loudest thing
// on it, and it tells the truth about what being on shift means.** Off shift, a
// rider is invisible to `freeRidersNear()` and does not count towards
// `hasRiderCoverage()`, which means the shops around them can stop being
// serviceable at all (HANDOFF §3). A toggle that just said "Available" would be
// hiding that; this one says who is waiting on it.
//
// Three rules the interaction has to get right:
//
//   • **The server owns the shift, and this screen never guesses.** Going off
//     shift while carrying a job is refused with a 409 — the rider is holding
//     somebody's order and mid-flight reassignment does not exist. An optimistic
//     toggle would show "off" to a rider the platform is still assigning orders
//     to, which is the worst lie this app could tell. `setShift` in
//     `session.js` only ever sets the flag from a response that succeeded.
//   • **Coming on shift can hand you work immediately.** An order that reached
//     READY with nobody on shift sits `UNASSIGNED` until somebody clocks in, and
//     the response says how many were picked up. Silently landing three
//     deliveries in a rider's list is not the same as telling them.
//   • **Location is a precondition, not a preference.** A rider who denied the
//     permission is on shift and will still never be offered anything, because
//     assignment is by distance. That gets a banner, not a footnote.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Switch, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  SectionHeader,
  StatGrid,
  StatTile,
  GreetingHeader,
  timeGreeting,
  OrderCard,
  EmptyState,
  Banner,
  connectionMessage,
  SkeletonCard,
  formatINR,
  Gradient,
  shadowLift
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { useLocationReporting, locationMessage } from '../../src/useLocationReporting.js';
import { POLL_MS } from '../../src/config.js';
import { isLive, jobStatusLabel, jobStatusTone, formatAddress } from '../../src/job.js';

export default function Shift() {
  const api = useApi();
  const router = useRouter();
  const { user, isOnShift, setShift, isEmployedByShop, employer } = useSession();
  const [switching, setSwitching] = useState(false);

  const jobs = useResource(useCallback(() => api.listJobs(), [api]), { intervalMs: POLL_MS.jobs });
  const cash = useResource(useCallback(() => api.getRemittance(), [api]), { intervalMs: POLL_MS.cash });
  // Asked for every rider since 2026-08-09. This used to be skipped for a shop's
  // own delivery boy, because the endpoint refused him — the platform paid him
  // nothing. It pays every rider the same now, so he has takings to see and not
  // asking would be the app hiding his own money from him.
  const earnings = useResource(useCallback(() => api.getEarnings(), [api]), {
    intervalMs: POLL_MS.earnings
  });

  // Reporting is bound to the shift flag, so switching off stops it in the same
  // tick. A rider who has finished for the day is not the platform's to follow.
  const location = useLocationReporting({
    active: isOnShift,
    report: useCallback((lat, lng) => api.reportLocation(lat, lng), [api])
  });

  const jobList = jobs.data?.jobs ?? [];
  const live = jobList.filter(isLive);
  const current = live[0] ?? null;

  const toggle = async (next) => {
    setSwitching(true);
    try {
      const result = await setShift(next);
      if (next && result.jobsAssigned > 0) {
        // Say it out loud. Three deliveries appearing in a list nobody was
        // looking at is how a rider misses the first one.
        Alert.alert(
          result.jobsAssigned === 1 ? 'You have a delivery' : `You have ${result.jobsAssigned} deliveries`,
          'Orders that were waiting for a rider have been assigned to you.'
        );
      }
      jobs.reload({ silent: true });
    } catch (error) {
      if (error.isConflict) {
        // The one refusal that is not a failure: he is still carrying an order.
        Alert.alert(
          'Finish your delivery first',
          'You are still carrying an order. Deliver it, or report a dead run, before going off shift.'
        );
      } else if (error.isNetwork) {
        Alert.alert('No connection', 'Could not reach RoadMate. Check the connection and try again.');
      } else {
        Alert.alert('Could not change your shift', error.message);
      }
    } finally {
      setSwitching(false);
    }
  };

  const problem = connectionMessage(jobs.error ?? cash.error);
  const permission = locationMessage(location.status);

  const today = earnings.data?.today ?? null;

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl
          refreshing={jobs.refreshing}
          onRefresh={() => {
            jobs.reload();
            cash.reload();
            earnings.reload();
          }}
          tintColor={colors.accent}
        />
      }
    >
      <GreetingHeader name={user?.name} greeting={timeGreeting()} />

      {problem ? <Banner message={problem} action="Retry" onAction={() => jobs.reload()} /> : null}
      {isOnShift && permission ? (
        <Banner tone="danger" message={permission} action="Try again" onAction={location.reportNow} />
      ) : null}

      {/* ── The switch ──────────────────────────────────────────────────────
          "Am I earning right now" is the one thing a rider checks at a glance
          from a bike, so this is the loudest element on the screen — and since
          2026-08-11 it looks like it. It used to be a white card with a 1.5 px
          accent border, which is the same weight as every other card on the
          page: the most important control in the app was distinguishable only
          by reading it.

          On shift it is now a filled accent wash with a live status dot; off
          shift it is a plain card. That difference is legible at arm's length
          in sunlight, which is the actual viewing condition.

          ⚠️ `Gradient` and not `expo-linear-gradient` — a native view would
          break every installed dev client (see `packages/ui/src/Gradient.js`). */}
      <View style={styles.shiftWrap}>
        {isOnShift ? (
          <Gradient
            colors={[colors.accentDim, colors.accent]}
            direction="horizontal"
            radius={radius.md}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={[styles.shift, !isOnShift && styles.shiftOff]}>
          <View style={styles.shiftText}>
            <View style={styles.shiftTitleRow}>
              {/* A dot, not an icon: "live" is a state, and a pulsing-green
                  convention is read faster than any glyph. */}
              <View style={[styles.dot, isOnShift ? styles.dotOn : styles.dotOff]} />
              <Text style={styles.shiftTitle}>
                {isOnShift ? 'You are on shift' : 'You are off shift'}
              </Text>
            </View>
            <Text style={[typography.meta, isOnShift && styles.shiftMetaOn]}>
              {isOnShift
                ? 'Orders near you can be assigned to you. Keep the app open while you ride.'
                : 'You will not be offered any deliveries until you go on shift.'}
            </Text>
          </View>
          <Switch
            value={isOnShift}
            disabled={switching}
            onValueChange={toggle}
            // Inverted on the accent wash: a yellow track on a yellow card is
            // invisible, which is the one control that must never be.
            trackColor={{ true: colors.ink, false: colors.border }}
            thumbColor={colors.card}
          />
        </View>
      </View>

      <View>
        <SectionHeader title={current ? 'Right now' : 'Your next delivery'} />
        {jobs.loading && !jobs.data ? (
          <SkeletonCard count={1} />
        ) : current ? (
          <OrderCard
            title={current.order?.orderNumber ?? `Job #${current.id}`}
            meta={[
              current.pickup?.name ? `Collect from ${current.pickup.name}` : null,
              formatAddress(current.drop)
            ]
              .filter(Boolean)
              .join(' → ')}
            status={current.status}
            statusLabel={jobStatusLabel(current)}
            statusTone={jobStatusTone(current)}
            amount={current.order?.collectAmount ? formatINR(current.order.collectAmount) : undefined}
            action="Open"
            onPress={() => router.push(`/(rider)/job/${current.id}`)}
            footer={
              current.order?.collectAmount
                ? `Collect ${formatINR(current.order.collectAmount)} in cash at the door`
                : 'Already paid online — collect nothing'
            }
          />
        ) : (
          <Card>
            <EmptyState
              title={isOnShift ? 'Nothing assigned yet' : 'Off shift'}
              message={
                isOnShift
                  ? 'Deliveries are given out when a shop finishes packing an order near you. You do not need to refresh — it will appear here.'
                  : 'Go on shift above to start being given deliveries.'
              }
            />
          </Card>
        )}
        {live.length > 1 ? (
          <Text style={styles.more}>
            {live.length - 1} more {live.length - 1 === 1 ? 'delivery' : 'deliveries'} in your Jobs tab.
          </Text>
        ) : null}
      </View>

      <View>
        <SectionHeader title="Today" />
        <StatGrid>
          {/* Every rider sees their pay since 2026-08-09. This used to swap in
              "Deliveries in hand" for a shop's own boy, because RoadMate paid
              him nothing and must not have appeared to be counting his money.
              The platform pays every rider the same now, so the figure is real
              for him too. */}
          <StatTile label="Earned today" value={formatINR(today?.earned ?? '0.00')} icon="earnings" tone="success" />
          <StatTile label="Deliveries" value={String(today?.deliveries ?? 0)} icon="deliveries" />
          <StatTile
            label="Cash in hand"
            value={formatINR(cash.data?.totalHeld ?? '0.00')}
            icon="cash"
            tone={Number(cash.data?.count ?? 0) > 0 ? 'warning' : undefined}
            onPress={() => router.push('/(rider)/cash')}
          />
        </StatGrid>
      </View>

      {/* Who he works for is still worth saying — the platform pays him per
          delivery now, but his employer decides which orders he gets, and may
          pay him as well on terms RoadMate is not party to. */}
      {isEmployedByShop && employer ? (
        <Card>
          <Text style={typography.meta}>
            You deliver for {employer.name}. They give you your orders. RoadMate pays you for each
            delivery you complete, the same as any delivery partner — anything your shop pays you is
            between you and them.
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },

  // The wrap carries the rounded corner and the lift; the gradient sits inside it
  // absolutely, and the content sits on top of that. No `overflow: 'hidden'` —
  // see `Gradient`'s header for why that eats children on Android.
  shiftWrap: { borderRadius: radius.md, ...shadowLift },
  shift: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.lg
  },
  // Off shift is a plain card: the accent is reserved for "you are earning".
  shiftOff: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  shiftText: { flex: 1, gap: spacing.xs },
  shiftTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shiftTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  // Ink at 70% rather than `inkMuted`: the muted grey was chosen against white
  // and goes muddy on the accent wash.
  shiftMetaOn: { color: '#4A4123' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotOn: { backgroundColor: colors.success },
  dotOff: { backgroundColor: colors.inkFaint },

  more: { ...typography.meta, marginTop: spacing.sm, textAlign: 'center' }
});
