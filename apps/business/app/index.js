// The door. Decides, once the session has restored, which app this person is in.
//
// One codebase, four shipped apps (HANDOFF §4, revised 2026-08-08): `RoadMate
// Shop`, `RoadMate Manufacturer`, `RoadMate Distributor` and `RoadMate
// Regional` are Expo variants of this project, and `src/variant.js` says which
// role the build in your hand serves. The shop gets `(shop)`; the three partner
// roles still share `(exec)`, one section whose tabs and stats come from
// `src/roles.js`.
//
// ⚠️ Four *listings*, one `(exec)` section — those are different things and the
// split did not merge them. The three partner roles differ by which endpoints
// return something, which is a table, not an app. Each build simply ships with
// one role in `VARIANT.roles`, so `servesRole` admits exactly one of them.
//
// Three outcomes, and the middle one is the reason this file grew:
//
//   1. The role belongs to this build  → straight into its section.
//   2. The role is a real RoadMate role, but belongs to the *other* build →
//      **"wrong app", named.** Every partner is onboarded by a field executive
//      who tells them what to download, and some are told wrong. A working
//      sign-in that lands on empty tabs is a support call; a named wrong-app
//      message is a thirty-second fix.
//   3. The role has no app at all (Master, State, District, Industry-State) →
//      say so, and point at the web dashboard.
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { colors, spacing, typography, Button, EmptyState } from '@roadmate/ui';
import { useSession } from '../src/session.js';
import { isExecRole } from '../src/roles.js';
import { VARIANT, servesRole, appForRole } from '../src/variant.js';

export default function Index() {
  const { loading, isSignedIn, user, signOut } = useSession();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={typography.meta}>{VARIANT.name}</Text>
      </View>
    );
  }

  if (!isSignedIn) return <Redirect href="/sign-in" />;

  // Only ever route into a section this build actually ships. `servesRole` is
  // what keeps a shop owner out of the Partner app's tabs and vice versa; both
  // section layouts re-check it too, because a deep link (a push notification)
  // can land on a tab without passing through here.
  if (servesRole(user.role)) {
    if (user.role === 'SHOP') return <Redirect href="/(shop)" />;
    if (isExecRole(user.role)) return <Redirect href="/(exec)" />;
  }

  const shouldHave = appForRole(user.role);

  return (
    <View style={styles.center}>
      <EmptyState
        title={shouldHave ? 'This is the wrong app' : `${titleCase(user.role)} has no app yet`}
        message={
          shouldHave
            ? `Your account signs in to ${shouldHave}. You have ${VARIANT.name}, which is ${lowerFirst(
                VARIANT.tagline
              )}. Install ${shouldHave} and sign in there with the same details.`
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

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.page
  }
});
