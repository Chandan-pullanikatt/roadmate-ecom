// Root layout: the session, and nothing else. Every route below it can assume a
// session exists and has finished restoring.
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@roadmate/ui';
import { SessionProvider } from '../src/session.js';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
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
          <Stack.Screen name="(shop)" options={{ headerShown: false }} />
          {/* ⚠️ Both sections must be declared, not just the one. A group with no
              `Stack.Screen` entry gets expo-router's *default* header, and the
              title it defaults to is the route name — so the executive apps have
              been shipping a page headed literally "(exec)", above a screen that
              draws its own greeting header. It looked like chrome rather than
              like a bug, which is why it survived. */}
          <Stack.Screen name="(exec)" options={{ headerShown: false }} />
          {/* Root-level, not inside a section: the three billable roles span
              both `(shop)` and `(exec)` and see the identical screen. */}
          <Stack.Screen name="subscription" options={{ title: 'Subscription' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
