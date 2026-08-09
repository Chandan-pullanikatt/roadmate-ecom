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
  formatINR
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
  // A shop's own delivery boy has no platform earnings and the endpoint refuses
  // him (403 `EMPLOYED_BY_SHOP`). Not asking is the point — a request we know
  // will fail is not a graceful degradation, it is a banner he cannot act on.
  const earnings = useResource(useCallback(() => api.getEarnings(), [api]), {
    intervalMs: POLL_MS.earnings,
    enabled: !isEmployedByShop
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
            if (!isEmployedByShop) earnings.reload();
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

      {/* The switch. Accent-edged when on, because "am I earning right now" is
          the one thing a rider checks at a glance from a bike. */}
      <View style={[styles.shift, isOnShift && styles.shiftOn]}>
        <View style={styles.shiftText}>
          <Text style={styles.shiftTitle}>{isOnShift ? 'You are on shift' : 'You are off shift'}</Text>
          <Text style={typography.meta}>
            {isOnShift
              ? 'Orders near you can be assigned to you. Keep the app open while you ride.'
              : 'You will not be offered any deliveries until you go on shift.'}
          </Text>
        </View>
        <Switch
          value={isOnShift}
          disabled={switching}
          onValueChange={toggle}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.card}
        />
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
          {/* A shop's own boy sees his work, not his pay: RoadMate does not pay
              him and must not appear to be counting his money (HANDOFF §3). */}
          {isEmployedByShop ? (
            <StatTile label="Deliveries in hand" value={String(live.length)} icon="▤" tone="info" />
          ) : (
            <>
              <StatTile label="Earned today" value={formatINR(today?.earned ?? '0.00')} icon="₹" tone="success" />
              <StatTile label="Deliveries" value={String(today?.deliveries ?? 0)} icon="✓" />
            </>
          )}
          <StatTile
            label="Cash in hand"
            value={formatINR(cash.data?.totalHeld ?? '0.00')}
            icon="⛁"
            tone={Number(cash.data?.count ?? 0) > 0 ? 'warning' : undefined}
            onPress={() => router.push('/(rider)/cash')}
          />
        </StatGrid>
      </View>

      {isEmployedByShop && employer ? (
        <Card>
          <Text style={typography.meta}>
            You deliver for {employer.name}. They give you your orders and they pay you — RoadMate does
            not. Anything about your earnings is a question for them.
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },

  shift: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg
  },
  shiftOn: { borderColor: colors.accent, backgroundColor: colors.card },
  shiftText: { flex: 1, gap: spacing.xs },
  shiftTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },

  more: { ...typography.meta, marginTop: spacing.sm, textAlign: 'center' }
});
