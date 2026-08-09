// Root layout: the session, then the place (where and what kind of shopping).
// Every route below can assume both exist and have finished restoring.
//
// `PlaceProvider` sits *inside* `SessionProvider` because it needs the API
// client the session builds — the address book is per customer, and the token
// is what makes it one customer's.
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@roadmate/ui';
import { SessionProvider } from '../src/session.js';
import { PlaceProvider } from '../src/place.js';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PlaceProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: colors.page },
              headerTitleStyle: { fontWeight: '700', color: colors.ink },
              contentStyle: { backgroundColor: colors.page }
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

            {/* Reached from a card or a bar, never from the nav. */}
            <Stack.Screen name="shop/[shopId]" options={{ title: 'Shop' }} />
            <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
            <Stack.Screen name="order/[orderId]" options={{ title: 'Your order' }} />
            <Stack.Screen name="addresses" options={{ title: 'Delivery addresses' }} />
          </Stack>
        </PlaceProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
