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
//
// ⚠️ **The icons are a real icon font, not typographic glyphs** (the storefront
// pass, 2026-08-10). This bar used to draw `⌂ ⌕ ▤ ◷ ☺` — Unicode characters
// borrowed for their shape, which is not a thing they promise to keep: they
// render at different weights and baselines on every Android OEM's system font,
// several have no colour-emoji fallback, and `☺` renders as a black-and-white
// dingbat on some devices and a yellow emoji face on others. `@expo/vector-icons`
// ships the font in the bundle, so the bar is the same bar on every phone.
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@roadmate/ui';
import { useSession } from '../../src/session.js';

// Outline when idle, solid when active — the active tab already has the accent
// pill behind it, and a second weight change is what makes the difference
// legible to somebody who cannot pick the yellow out.
const tabIcon = (name) => ({ color, focused, size }) => (
  <Ionicons name={focused ? name : `${name}-outline`} size={size ?? 22} color={color} />
);

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
        options={{ title: 'Home', headerShown: false, tabBarIcon: tabIcon('home') }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', headerShown: false, tabBarIcon: tabIcon('search') }}
      />
      <Tabs.Screen name="cart" options={{ title: 'Cart', tabBarIcon: tabIcon('basket') }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: tabIcon('receipt') }} />
      {/* No header: Profile draws its own accent one that runs to the top edge
          of the glass, like Home's. A grey navigation bar above a yellow
          identity block reads as two different apps. */}
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', headerShown: false, tabBarIcon: tabIcon('person') }}
      />
    </Tabs>
  );
}
