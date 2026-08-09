// The rider's bottom nav (HANDOFF §5: icon over label, accent when active).
//
// Four tabs for a RoadMate delivery partner, **three** for a shop's own
// delivery boy — and that one hidden tab is the entire visible difference
// between the two kinds of rider (HANDOFF §3). Everything else is identical,
// which is why this is one app and not two.
//
// **Why hidden rather than empty.** `GET /api/rider/earnings` answers 403
// `EMPLOYED_BY_SHOP` for a shop's employee, deliberately, instead of a screen of
// zeroes: "RoadMate owes you nothing this week" and "RoadMate is not who pays
// you" are different claims, and the first one is a wage dispute waiting to
// happen. Rendering the tab and letting it fail would tell exactly that lie for
// as long as the request took. `employerShopId` on `/api/auth/me` is what this
// reads; the Profile screen is where he is told who does pay him.
//
// Cash stays for both. A shop's own boy still collects COD at the door, and
// today that cash is still recorded as platform-collected — which is HANDOFF
// §7.8a, unanswered, and deliberately untouched. Hiding the screen would not
// change the ledger, it would only stop him seeing what he is carrying.
import React from 'react';
import { Text } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { colors } from '@roadmate/ui';
import { useSession, isRiderAccount } from '../../src/session.js';

const TabIcon = ({ glyph, color }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function RiderLayout() {
  const { loading, isSignedIn, user, isEmployedByShop } = useSession();

  // Guarding here as well as at the door: a deep link (a push notification
  // opening a job) can land on a tab directly without ever passing through
  // `app/index.js`. Bouncing to `/` gets the honest "wrong app" message rather
  // than a half-working screen.
  if (loading) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  if (!isRiderAccount(user)) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.onAccent,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarActiveBackgroundColor: colors.accentSoft,
        tabBarItemStyle: { borderRadius: 10, marginHorizontal: 4, marginVertical: 6 },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: 64 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.page },
        headerTitleStyle: { fontWeight: '700', color: colors.ink },
        sceneStyle: { backgroundColor: colors.page }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Shift', headerShown: false, tabBarIcon: (p) => <TabIcon glyph="◉" {...p} /> }}
      />
      <Tabs.Screen
        name="jobs"
        options={{ title: 'Jobs', tabBarIcon: (p) => <TabIcon glyph="▤" {...p} /> }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          // `href: null` removes the tab AND makes the route unreachable by
          // link, which is the half that matters — the screen defends itself as
          // well, but a rider should never get far enough to need that.
          href: isEmployedByShop ? null : undefined,
          tabBarIcon: (p) => <TabIcon glyph="₹" {...p} />
        }}
      />
      <Tabs.Screen
        name="cash"
        options={{ title: 'Cash', tabBarIcon: (p) => <TabIcon glyph="⛁" {...p} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: (p) => <TabIcon glyph="☺" {...p} /> }}
      />

      {/* Reached from a job card and from a push notification, not from the nav. */}
      <Tabs.Screen name="job/[jobId]" options={{ href: null, title: 'Delivery' }} />
    </Tabs>
  );
}
