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
          {/* Self-registration (2026-08-11). The only route reachable *without* a
              session — it runs on a 15-minute signup ticket, not a token, so it
              sits here beside sign-in rather than inside `(rider)`. Its own header
              is off because the screen carries its own step indicator. */}
          <Stack.Screen name="register" options={{ headerShown: false }} />
          <Stack.Screen name="(rider)" options={{ headerShown: false }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
