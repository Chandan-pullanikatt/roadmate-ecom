// The executive bottom nav — the designed Partner nav (Home / Products /
// Orders / Profile, `designs/Partner.png`) with one tab that varies by role.
//
// HANDOFF §4: "near-identical bottom navs, one tab varying". That is literally
// what this is. `Network` and `Products` are each shown only when the role has
// one — a Manufacturer onboards nobody and a Regional partner sells nothing —
// and `src/roles.js` is where that is decided, so this file has no role names
// in it at all.
import React from 'react';
import { Text } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { colors } from '@roadmate/ui';
import { useSession } from '../../src/session.js';
import { isExecRole, roleConfig } from '../../src/roles.js';
import { servesRole } from '../../src/variant.js';

const TabIcon = ({ glyph, color }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function ExecLayout() {
  const { loading, isSignedIn, user } = useSession();

  // Guarded here as well as at the door: a deep link (a push notification) can
  // open a tab without passing through `index.js`. `servesRole` is the second
  // half — these routes are still compiled into the Shop build, so without it a
  // deep link could open the partner tabs in the shop's app.
  if (loading) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  if (!isExecRole(user.role) || !servesRole(user.role)) return <Redirect href="/" />;

  const { tabs } = roleConfig(user.role);

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
        options={{ title: 'Home', headerShown: false, tabBarIcon: (p) => <TabIcon glyph="⌂" {...p} /> }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: 'Orders', tabBarIcon: (p) => <TabIcon glyph="▤" {...p} /> }}
      />
      {/* `href: null` keeps the route reachable by push while hiding the tab —
          a role without a network can still be linked to it and will see the
          screen's own honest empty state rather than a dead link. */}
      <Tabs.Screen
        name="network"
        options={{
          title: 'Network',
          href: tabs.network ? undefined : null,
          tabBarIcon: (p) => <TabIcon glyph="🤝" {...p} />
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Products',
          href: tabs.products ? undefined : null,
          tabBarIcon: (p) => <TabIcon glyph="▦" {...p} />
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: (p) => <TabIcon glyph="☺" {...p} /> }}
      />

      {/* Reached from an order row's "Details ›", not from the nav. */}
      <Tabs.Screen name="order/[orderId]" options={{ href: null, title: 'Order' }} />
    </Tabs>
  );
}
