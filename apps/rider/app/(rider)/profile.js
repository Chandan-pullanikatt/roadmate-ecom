// Who this rider is, who pays them, and the way out.
//
// The one thing this screen exists to say that no other screen can: **who you
// deliver for.** That is the whole reason `GET /api/auth/me` carries
// `employerShop.name` and not just the id (HANDOFF §3) — "Kannan Motors gives you
// your orders" is an explanation, and an app that simply behaves differently for
// him without saying why is an app that looks broken.
//
// Signing out is refused while carrying a job, for the same reason going off
// shift is: a parcel that belongs to nobody is worse than a session that stayed
// open. That check is local, because signing out is local — there is no endpoint
// to refuse it. It is a warning rather than a hard block: a rider whose phone is
// about to be handed back to a shop must still be able to get out.
//
// ── THE LAYOUT, AND WHY IT CHANGED (2026-08-11) ─────────────────────────────
//
//   • **The identity is a header, not a row.** Avatar-plus-name floating on the
//     page grey read as an unstyled list item; it is the subject of the screen.
//   • **"Right now" is three tiles, not three list rows.** Shift / in hand / cash
//     are *figures*, and the app renders figures as tiles everywhere else — as
//     list rows they were three lines of small grey text saying "Off", "0",
//     "₹0.00", which is the least legible way to show the two facts a rider
//     checks before going home.
//   • **"You deliver for" is a chip in the header plus one sentence**, not a
//     bordered card containing a paragraph. It is one fact.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  shadowLift,
  SectionHeader,
  GroupedCard,
  GroupedRow,
  StatGrid,
  StatTile,
  Gradient,
  Icon,
  Button,
  Banner,
  connectionMessage,
  initialsOf,
  formatINR
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';
import { isLive } from '../../src/job.js';

/**
 * Is this an address a human would recognise as their own?
 *
 * ⚠️ **A rider's `email` is very often synthetic and must not be shown.**
 * `User.email` is unique and NOT NULL in the schema, but nobody types one for a
 * delivery partner — `registerRider` mints `rider-<phone>@self.roadmate.local`
 * and `createShopRider` mints `rider-<phone>@shop<id>.roadmate.local`, purely to
 * satisfy the column. Rendering it put **`rider-6238481236@self.roadmate.local`**
 * on a rider's own profile: an address that does not exist, that he cannot use to
 * sign in, and that looks like a bug or a leak to anybody being shown the app.
 *
 * Matching the internal domain rather than the local part, because the local part
 * is the phone number and a real address could contain one.
 */
const isRealEmail = (email) =>
  typeof email === 'string' && email.length > 0 && !email.endsWith('.roadmate.local');

export default function Profile() {
  const api = useApi();
  const { user, signOut, isOnShift, isEmployedByShop, employer, refreshUser } = useSession();

  const jobs = useResource(useCallback(() => api.listJobs(), [api]), {
    cacheKey: 'jobs',
    intervalMs: POLL_MS.jobs
  });
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
        : 'You will need your mobile number and a code we send to it to sign back in.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: signOut }
      ]
    );
  };

  const problem = connectionMessage(jobs.error ?? cash.error);
  const employerName = employer?.name ?? 'your shop';

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

      {/* ── Identity ────────────────────────────────────────────────────────
          The accent wash again, which by now is this app's language for "this is
          about you and your money" — the shift switch and the earnings hero use
          it. The chip is the "who pays you" answer, in the place somebody looks
          for identity rather than three sections down. */}
      <View style={styles.headerWrap}>
        <Gradient
          colors={[colors.accentDim, colors.accent]}
          direction="horizontal"
          radius={radius.md}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.header}>
          {/* Not `Avatar`: that one is `infoSoft` blue on white, which disappears
              into the accent wash. Ink-on-translucent keeps the contrast. */}
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialsOf(user?.name)}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>
              {user?.name ?? 'Delivery partner'}
            </Text>
            <Text style={styles.phone}>{user?.phone ? `+91 ${user.phone}` : ''}</Text>
            <View style={styles.chip}>
              <Icon name={isEmployedByShop ? 'shop' : 'rider'} size={12} color={colors.ink} />
              <Text style={styles.chipText} numberOfLines={1}>
                {isEmployedByShop ? employerName : 'RoadMate delivery partner'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Right now ───────────────────────────────────────────────────────
          Figures, so: tiles, like every other figure in this app. These were
          three list rows of small grey text, which is the least legible way to
          show the two things a rider checks before going home. */}
      <View>
        <SectionHeader title="Right now" />
        <StatGrid>
          <StatTile
            label="Shift"
            value={isOnShift ? 'On' : 'Off'}
            icon="shift"
            tone={isOnShift ? 'success' : undefined}
          />
          <StatTile label="In hand" value={String(carrying)} icon="orders" tone={carrying ? 'info' : undefined} />
          <StatTile
            label="Cash to hand in"
            value={formatINR(holding)}
            icon="cash"
            tone={holdingCount > 0 ? 'warning' : undefined}
          />
        </StatGrid>
      </View>

      {/* One sentence, not a bordered paragraph. The header chip already said
          who; this says what it means for his money. */}
      <Text style={styles.explainer}>
        {isEmployedByShop
          ? `You are ${employerName}'s own delivery staff, so you only ever get their orders — never another shop's. RoadMate still pays you for every delivery you complete, the same as any delivery partner, and you can see it in the Earnings tab. Anything your shop pays you on top is between you and them.`
          : 'Orders come from any shop near you. RoadMate pays you per delivery and settles weekly — see the Earnings tab.'}
      </Text>

      <View>
        <SectionHeader title="Account" />
        <GroupedCard>
          <GroupedRow label="Mobile" value={user?.phone ?? '—'} />
          {/* ⚠️ Only a real address. See `isRealEmail` — a rider's is usually
              synthetic and was being shown to him verbatim. */}
          {isRealEmail(user?.email) ? <GroupedRow label="Email" value={user.email} /> : null}
          {user?.districtName ? <GroupedRow label="District" value={user.districtName} /> : null}
          {user?.regionName ? <GroupedRow label="Area" value={user.regionName} /> : null}
          {user?.vehicleType ? (
            <GroupedRow
              label="Vehicle"
              value={[user.vehicleType, user.vehicleNumber].filter(Boolean).join(' · ')}
            />
          ) : null}
        </GroupedCard>
        <Text style={styles.footnote}>
          Anything wrong here is changed by {isEmployedByShop ? 'your shop' : 'your RoadMate contact'},
          not from this app.
        </Text>
      </View>

      <Button label="Sign out" variant="danger" onPress={confirmSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },

  headerWrap: { borderRadius: radius.md, ...shadowLift },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.md
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    // Translucent ink rather than a solid fill: it reads as part of the wash
    // instead of a sticker on top of it.
    backgroundColor: 'rgba(26,26,26,0.10)'
  },
  avatarText: { fontSize: 22, fontWeight: '800', color: colors.ink },
  headerText: { flex: 1, gap: 3 },
  name: { fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  phone: { fontSize: 13, fontWeight: '600', color: '#4A4123' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.55)'
  },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.ink },

  explainer: { ...typography.meta, lineHeight: 19 },
  footnote: { ...typography.meta, marginTop: spacing.md }
});
