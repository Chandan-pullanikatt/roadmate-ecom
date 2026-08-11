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
        // ⚠️ Not "your phone number and password" any more (2026-08-11). Sign-in is
        // phone + OTP, and a rider who registered himself has **no password at
        // all** (`server/src/lib/password.js`) — so the old wording sent him
        // looking for a credential that does not exist.
        : 'You will need your mobile number and a code we send to it to sign back in.',
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
              {/* ⚠️ **Corrected 2026-08-11.** This said "They pay you, not RoadMate,
                  which is why there is no earnings screen in this app" — and both
                  halves stopped being true on 2026-08-09, when the client decided
                  the platform pays **every** rider ₹25 + ₹8/km. The earnings tab
                  has rendered unconditionally since (`(rider)/_layout.js`), so the
                  app was showing this rider a screen of his own money while a
                  different screen told him it did not exist. The worse half is that
                  it told him not to look. */}
              <Text style={[typography.meta, styles.paragraph]}>
                You are {employer?.name ?? 'your shop'}’s own delivery staff, so you only ever get their
                orders — never another shop’s. RoadMate still pays you for every delivery you
                complete, the same as any delivery partner, and you can see it in the Earnings tab.
                Anything your shop pays you on top is between you and them.
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
          {/* What he rides (2026-08-11). Shown because a self-registered rider
              typed it himself and this is the only place he can check it — and
              because a numberplate is what a shop reads out when a rider arrives. */}
          {user?.vehicleType ? (
            <GroupedRow
              label="Vehicle"
              value={[user.vehicleType, user.vehicleNumber].filter(Boolean).join(' · ')}
            />
          ) : null}
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
