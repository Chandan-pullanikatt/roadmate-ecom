// Profile — who you are, where you order to, and the way out.
//
// A customer profile is thin on purpose: `Customer` is a phone number, an
// optional name and an optional email, and there is no endpoint to change any
// of them. Rather than render an "Edit" button over nothing, this screen shows
// what the account is and links to the two things a customer actually manages —
// their addresses and their orders.
import React from 'react';
import { View, Text, ScrollView, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  colors,
  spacing,
  typography,
  Card,
  GroupedCard,
  GroupedRow,
  SectionHeader,
  Button,
  Avatar
} from '@roadmate/ui';
import { useSession } from '../../src/session.js';
import { usePlace } from '../../src/place.js';
import { PREPAID_ENABLED } from '../../src/config.js';
import { formatAddress } from '../../src/order.js';

export default function Profile() {
  const router = useRouter();
  const { customer, signOut } = useSession();
  const { address, addresses, industry } = usePlace();

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You will need your phone number and a new code to sign back in.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut }
    ]);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card style={styles.head}>
        <Avatar name={customer?.name || 'RoadMate customer'} size={56} />
        <View style={styles.headText}>
          <Text style={typography.sectionTitle}>{customer?.name || 'RoadMate customer'}</Text>
          <Text style={typography.meta}>+91 {customer?.phone}</Text>
        </View>
      </Card>

      <View>
        <SectionHeader title="Ordering" />
        <GroupedCard>
          <GroupedRow
            label="Delivery address"
            sublabel={address ? formatAddress(address) : 'Not chosen yet'}
            value={`${addresses.length}`}
            onPress={() => router.push('/addresses')}
          />
          <GroupedRow label="Category" value={industry?.name ?? '—'} />
          <GroupedRow
            label="Payment"
            // Not a preference — a fact about the platform right now. Saying it
            // here stops it being a surprise at the last tap of a checkout.
            value={PREPAID_ENABLED ? 'Cash or online' : 'Cash on delivery'}
          />
          <GroupedRow label="Your orders" onPress={() => router.push('/(tabs)/orders')} />
        </GroupedCard>
      </View>

      <View>
        <SectionHeader title="About" />
        <GroupedCard>
          <GroupedRow label="RoadMate" value="1.0.0" />
          <GroupedRow
            label="Delivering for a shop?"
            sublabel="Delivery partners use the RoadMate Rider app; shops use RoadMate Shop."
          />
        </GroupedCard>
      </View>

      <Button label="Sign out" variant="danger" onPress={confirmSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headText: { flex: 1, gap: 2 }
});
