// The customer's bottom nav (HANDOFF §5: icon over label, accent when active).
//
// Five tabs, and unlike the other two apps none of them is conditional. A shop
// or a rider sees a different app depending on who employs them; a customer is
// a customer. The industry switcher on the home screen is what changes what is
// *in* the tabs, never which tabs exist — seven industries are a filter, not
// seven navigations.
//
// **Cart is a tab, even though a cart belongs to one shop.** `GET
// /api/customer/cart` returns carts, plural: adding from a second shop opens a
// second cart rather than moving the first (server §1.3). That is the right
// model — a basket spanning two shops is two deliveries — but it means the
// customer can have baskets they have forgotten about, and a tab is the only
// place they can all be seen at once.
import React from 'react';
import { Text } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { colors } from '@roadmate/ui';
import { useSession } from '../../src/session.js';

const TabIcon = ({ glyph, color }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function TabsLayout() {
  const { loading, isSignedIn } = useSession();

  // Guarded here as well as at the door: a deep link (a push notification
  // opening an order) can land on a tab without passing through `app/index.js`.
  if (loading) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

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
        name="search"
        options={{ title: 'Search', headerShown: false, tabBarIcon: (p) => <TabIcon glyph="⌕" {...p} /> }}
      />
      <Tabs.Screen
        name="cart"
        options={{ title: 'Cart', tabBarIcon: (p) => <TabIcon glyph="▤" {...p} /> }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: 'Orders', tabBarIcon: (p) => <TabIcon glyph="◷" {...p} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: (p) => <TabIcon glyph="☺" {...p} /> }}
      />
    </Tabs>
  );
}
