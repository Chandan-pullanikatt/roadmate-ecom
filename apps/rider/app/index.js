// The door. Decides, once the session has restored, whether this account
// belongs in RoadMate Rider at all.
//
// One listing, **two kinds of rider** (HANDOFF §3): a RoadMate delivery partner
// and a shop's own delivery boy both belong here and both go straight through.
// The app they see differs by one tab, not by a section — see `(rider)/_layout`.
//
// The interesting case is the one this file exists for. `EXECUTIVE` is **two
// different jobs**:
//
//   • `executiveType: 'DELIVERY'` is a rider. This app.
//   • `executiveType: 'LISTING'` is a field executive who onboards shops. They
//     have no app and no web dashboard (HANDOFF §4, a known gap) — and they are
//     the single likeliest person to be handed this one by mistake, because
//     they share a role string with the people who should have it. Signing them
//     in to a job list that will be empty forever is the failure to avoid; the
//     role check alone would do exactly that.
//
// Everyone else — shops, the three partner roles, Master/State/District — is
// told which app is theirs, by name, exactly as `apps/business` does it. A
// field executive hands out app names and some are handed out wrong; "wrong
// app, install this one" is a thirty-second fix, a working sign-in with nothing
// in it is a support call.
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { colors, spacing, typography, Button, EmptyState } from '@roadmate/ui';
import { useSession, isRiderAccount } from '../src/session.js';

/**
 * Which app this person should have instead, by name — or null if we do not
 * know of one. The mirror of `APP_FOR_ROLE` in `apps/business/src/variant.js`.
 * Deliberately a name and not a deep link: we cannot know the other app is
 * installed, and a dead link is worse than a name they can search for.
 */
const APP_FOR_ROLE = {
  SHOP: 'RoadMate Shop',
  MANUFACTURER: 'RoadMate Manufacturer',
  DISTRIBUTOR: 'RoadMate Distributor',
  REGIONAL: 'RoadMate Regional'
};

export default function Index() {
  const { loading, isSignedIn, user, signOut } = useSession();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={typography.meta}>RoadMate Rider</Text>
      </View>
    );
  }

  if (!isSignedIn) return <Redirect href="/sign-in" />;

  // Both kinds of rider, together. Nothing here asks who employs them: the
  // backend has already partitioned the pool on `employerShopId`, so any job
  // that reaches this app is one this rider is allowed to have.
  if (isRiderAccount(user)) return <Redirect href="/(rider)" />;

  const shouldHave = APP_FOR_ROLE[user.role] ?? null;
  const isFieldExecutive = user.role === 'EXECUTIVE';

  return (
    <View style={styles.center}>
      <EmptyState
        title={
          isFieldExecutive
            ? 'This app is for delivery partners'
            : shouldHave
              ? 'This is the wrong app'
              : `${titleCase(user.role)} has no app yet`
        }
        message={
          isFieldExecutive
            ? 'Your account is a field executive, not a delivery partner. RoadMate Rider only carries deliveries. If you were told to install this to onboard shops, that is not what it does — ask your regional partner.'
            : shouldHave
              ? `Your account signs in to ${shouldHave}. You have RoadMate Rider, which is for delivery partners. Install ${shouldHave} and sign in there with the same details.`
              : 'The RoadMate apps are for shops, manufacturers, distributors, regional partners, delivery partners and customers. Your role works from the web dashboard.'
        }
        action={<Button label="Sign out" variant="ghost" onPress={signOut} />}
      />
    </View>
  );
}

const titleCase = (role) =>
  String(role ?? '')
    .toLowerCase()
    .replace(/(^|_)(\w)/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase());

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.page
  }
});
