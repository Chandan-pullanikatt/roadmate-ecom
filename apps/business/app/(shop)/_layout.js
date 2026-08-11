// The shop's bottom nav: five tabs, icon over label, accent when active
// (HANDOFF §5).
//
// The designs give the Partner app Home / Products / Orders / Profile. Two
// changes, both forced by the B2C half that the designs do not cover:
//
//   • "Orders" is now the *consumer* inbox — the 60-second offers and the orders
//     being packed. It is the screen this app exists for.
//   • "Stock" is new. Live per-shop stock is what the whole routing engine
//     believes when it decides who can fulfil an order (HANDOFF §3), and until
//     now nothing let the shop correct it.
//
// "Restock" is the designed Products tab, renamed for what it does: this is the
// shop buying, not the shop selling.
import React from 'react';
import { Text } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { colors, TabIcon } from '@roadmate/ui';
import { useSession } from '../../src/session.js';
import { servesRole } from '../../src/variant.js';

// ⚠️ Icons come from `@roadmate/ui`'s `ICONS` table, by concept, since 2026-08-11.
// They used to be Unicode characters in a <Text> — `⌂ ▤ ▦ ⇄ ☺` — which render as tofu
// boxes wherever the device font lacks them, and never optically align because each
// character has its own metrics. See `packages/ui/src/Icon.js`.

export default function ShopLayout() {
  const { loading, isSignedIn, user } = useSession();

  // Guarding here as well as in `app/index.js`: a deep link (a push
  // notification) can land on a tab directly without ever passing through the
  // door. `servesRole` is the second half of that — in the Partner build these
  // routes are still compiled in, so a deep link could otherwise open the shop
  // tabs in an app that is not the shop's. Bouncing to `/` gets the honest
  // "wrong app" message rather than a half-working screen.
  if (loading) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  if (user.role !== 'SHOP' || !servesRole(user.role)) return <Redirect href="/" />;

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
        options={{ title: 'Home', headerShown: false, tabBarIcon: TabIcon('home') }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: 'Orders', tabBarIcon: TabIcon('orders') }}
      />
      <Tabs.Screen
        name="stock"
        options={{ title: 'Stock', tabBarIcon: TabIcon('stock') }}
      />
      <Tabs.Screen
        name="restock"
        options={{ title: 'Restock', tabBarIcon: TabIcon('restock') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: TabIcon('profile') }}
      />

      {/* Reached from Quick Actions and from an order card, not from the nav. */}
      <Tabs.Screen name="order/[orderId]" options={{ href: null, title: 'Order' }} />
      <Tabs.Screen name="vouchers" options={{ href: null, title: 'Redeem voucher' }} />
      {/* Reached from Profile. Not a sixth tab: most shops use RoadMate's
          delivery partners and never open this, and the nav is already at the
          five the designs give it. */}
      <Tabs.Screen name="delivery" options={{ href: null, title: 'Delivery staff' }} />
    </Tabs>
  );
}
