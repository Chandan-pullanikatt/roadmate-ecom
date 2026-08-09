// The door.
//
// It is much shorter than the other two apps' doors, and the reason is worth
// stating: **there is no wrong customer.** `apps/business` and `apps/rider`
// both have to work out whether the account in front of them belongs in that
// listing at all, because six roles share one staff login and a field executive
// hands out app names. A customer signs in with a phone number and an OTP
// against `Customer`, a table nothing else in the platform authenticates
// against — there is no role to check, and no other app they could have meant
// to install.
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { colors, spacing, typography } from '@roadmate/ui';
import { useSession } from '../src/session.js';

export default function Index() {
  const { loading, isSignedIn } = useSession();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={typography.meta}>RoadMate</Text>
      </View>
    );
  }

  return <Redirect href={isSignedIn ? '/(tabs)' : '/sign-in'} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.page
  }
});
