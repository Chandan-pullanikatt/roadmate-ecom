// The rider's bottom nav (HANDOFF §5: icon over label, accent when active).
//
// **Four tabs for every rider.** ⚠️ Until 2026-08-09 a shop's own delivery boy
// got three, because RoadMate paid him nothing and `GET /api/rider/earnings`
// answered 403 `EMPLOYED_BY_SHOP` — showing him a screen of zeroes would have
// read as "we owe you nothing this week" rather than "we are not who pays you".
//
// The client reversed that: the platform now pays **every** rider the same
// ₹25 + ₹8/km, so a shop's boy has real earnings to see and hiding the tab
// would conceal money he is owed. The endpoint is open to him, `riderPay.js`
// pays him and `runRiderSettlement()` settles him.
//
// `isEmployedByShop` is still read elsewhere — Profile still names his employer,
// because his shop may pay him too on terms the platform is not party to. What
// it no longer decides is whether he can see what RoadMate owes him.
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { colors, TabIcon } from '@roadmate/ui';
import { useSession, isRiderAccount } from '../../src/session.js';

// ⚠️ Icons come from `@roadmate/ui`'s `ICONS` table, by concept, since 2026-08-11.
// They used to be Unicode characters in a <Text> — `◉ ▤ ₹ ⛁ ☺` — which render as
// tofu boxes wherever the device font lacks them, and never optically align
// because each character has its own metrics. See `packages/ui/src/Icon.js`.

export default function RiderLayout() {
  const { loading, isSignedIn, user } = useSession();

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
        options={{ title: 'Shift', headerShown: false, tabBarIcon: TabIcon('shift') }}
      />
      <Tabs.Screen
        name="jobs"
        options={{ title: 'Jobs', tabBarIcon: TabIcon('orders') }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: TabIcon('earnings')
        }}
      />
      <Tabs.Screen
        name="cash"
        options={{ title: 'Cash', tabBarIcon: TabIcon('cash') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: TabIcon('profile') }}
      />

      {/* Reached from a job card and from a push notification, not from the nav. */}
      <Tabs.Screen name="job/[jobId]" options={{ href: null, title: 'Delivery' }} />
    </Tabs>
  );
}
