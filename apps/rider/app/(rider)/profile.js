// Who this rider is, who pays them, and the way out.
//
// The one thing this screen exists to say that no other screen can: **who you
// deliver for.** A shop's own delivery boy has no earnings tab, and an app that
// simply lacks a tab is an app that looks broken. Naming the shop turns an
// absence into an explanation — "Kannan Motors pays you" — which is the whole
// reason `GET /api/auth/me` carries `employerShop.name` and not just the id
// (HANDOFF §3).
//
// Signing out is refused while carrying a job, for the same reason going off
// shift is: a parcel that belongs to nobody is worse than a session that stayed
// open. That check is local, because signing out is local — there is no endpoint
// to refuse it. It is a warning rather than a hard block: a rider whose phone is
// about to be handed back to a shop must still be able to get out.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  typography,
  Card,
  SectionHeader,
  GroupedCard,
  GroupedRow,
  Avatar,
  Button,
  Banner,
  connectionMessage,
  formatINR
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';
import { isLive } from '../../src/job.js';

export default function Profile() {
  const api = useApi();
  const { user, signOut, isOnShift, isEmployedByShop, employer, refreshUser } = useSession();

  const jobs = useResource(useCallback(() => api.listJobs(), [api]), { intervalMs: POLL_MS.jobs });
  const cash = useResource(useCallback(() => api.getRemittance(), [api]), { intervalMs: POLL_MS.cash });

  const carrying = (jobs.data?.jobs ?? []).filter(isLive).length;
  const holding = cash.data?.totalHeld ?? '0.00';
  const holdingCount = cash.data?.count ?? 0;

  const confirmSignOut = () => {
    const warnings = [
      carrying > 0
        ? `You are still carrying ${carrying} ${carrying === 1 ? 'delivery' : 'deliveries'}.`
        : null,
      holdingCount > 0 ? `You are holding ${formatINR(holding)} in cash that has not been handed in.` : null,
      isOnShift ? 'You are still on shift.' : null
    ].filter(Boolean);

    Alert.alert(
      'Sign out?',
      warnings.length
        ? `${warnings.join(' ')} Signing out does not change any of that — it only signs this phone out.`
        : 'You will need your phone number and password to sign back in.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: signOut }
      ]
    );
  };

  const problem = connectionMessage(jobs.error ?? cash.error);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl
          refreshing={jobs.refreshing}
          onRefresh={() => {
            jobs.reload();
            cash.reload();
            refreshUser().catch(() => {});
          }}
          tintColor={colors.accent}
        />
      }
    >
      {problem ? <Banner message={problem} action="Retry" onAction={() => jobs.reload()} /> : null}

      <View style={styles.head}>
        <Avatar name={user?.name} size={64} />
        <View style={styles.headText}>
          <Text style={typography.screenTitle}>{user?.name ?? 'Delivery partner'}</Text>
          <Text style={typography.meta}>{user?.phone ?? user?.email ?? ''}</Text>
        </View>
      </View>

      <View>
        <SectionHeader title="You deliver for" />
        <Card>
          {isEmployedByShop ? (
            <>
              <Text style={typography.cardTitle}>{employer?.name ?? 'Your shop'}</Text>
              <Text style={[typography.meta, styles.paragraph]}>
                You are {employer?.name ?? 'your shop'}’s own delivery staff, so you only ever get their
                orders — never another shop’s. They pay you, not RoadMate, which is why there is no
                earnings screen in this app. Anything about your pay is a question for them.
              </Text>
            </>
          ) : (
            <>
              <Text style={typography.cardTitle}>RoadMate</Text>
              <Text style={[typography.meta, styles.paragraph]}>
                You are a RoadMate delivery partner. Orders come from any shop near you, and RoadMate
                pays you per delivery and settles weekly — see the Earnings tab.
              </Text>
            </>
          )}
        </Card>
      </View>

      <View>
        <SectionHeader title="Right now" />
        <GroupedCard>
          <GroupedRow
            label="Shift"
            value={isOnShift ? 'On' : 'Off'}
            tone={isOnShift ? 'success' : undefined}
          />
          <GroupedRow label="Deliveries in hand" value={String(carrying)} />
          <GroupedRow
            label="Cash to hand in"
            value={formatINR(holding)}
            tone={holdingCount > 0 ? 'warning' : undefined}
          />
        </GroupedCard>
      </View>

      <View>
        <SectionHeader title="Account" />
        <GroupedCard>
          <GroupedRow label="Phone" value={user?.phone ?? '—'} />
          {user?.email ? <GroupedRow label="Email" value={user.email} /> : null}
          {/* Territory is what the field executive registered, and it is the
              only thing here a rider might spot as wrong. It is read-only —
              changing it is an operations decision, not a self-service one. */}
          {user?.districtName ? <GroupedRow label="District" value={user.districtName} /> : null}
          {user?.regionName ? <GroupedRow label="Area" value={user.regionName} /> : null}
        </GroupedCard>
        <Text style={styles.footnote}>
          Anything wrong here is changed by {isEmployedByShop ? 'your shop' : 'your RoadMate contact'}, not
          from this app.
        </Text>
      </View>

      <Button label="Sign out" variant="danger" onPress={confirmSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headText: { flex: 1, gap: 2 },
  paragraph: { marginTop: spacing.sm, lineHeight: 18 },
  footnote: { ...typography.meta, marginTop: spacing.md }
});
