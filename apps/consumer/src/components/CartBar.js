// The sticky "1 Item added · View Cart" bar (the storefront pass, 2026-08-10).
//
// The design has it on every browsing screen, and it is the one piece of chrome
// here that is doing real work rather than decoration: **a cart in this app is
// per shop and there can be several**. The Cart tab exists precisely so
// forgotten baskets are visible (see `app/(tabs)/cart.js`), but a tab is
// somewhere you have to go. This is the same information where the customer
// already is.
//
// So it says how many *shops* when there is more than one, and never pretends
// two baskets are one total. "3 items" across two shops is two deliveries, two
// accept windows and two riders, and rolling them into one number would be the
// app quietly contradicting the model underneath it.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadowLift } from '@roadmate/ui';

/**
 * @param {object} props
 * @param {Array} props.carts   `GET /api/customer/cart`'s carts, plural
 * @param {() => void} props.onPress
 * @param {number} [props.bottom] inset to clear the tab bar
 */
export default function CartBar({ carts, onPress, bottom = 0 }) {
  const live = (carts ?? []).filter((c) => c.items?.length);
  if (!live.length) return null;

  const items = live.reduce((sum, cart) => sum + cart.items.length, 0);
  const label =
    live.length > 1
      ? `${items} items in ${live.length} baskets`
      : `${items} item${items === 1 ? '' : 's'} added`;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.bar, { bottom: bottom + spacing.sm }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. View cart.`}
    >
      <View style={styles.left}>
        <Ionicons name="basket" size={18} color={colors.onAccent} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.action}>View Cart</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.onAccent} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    ...shadowLift
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  // Ink on the accent, always — #DEBE10 is a mid-tone yellow and white on it
  // fails contrast at every weight (`colors.onAccent`, tokens.js).
  label: { fontSize: 13, fontWeight: '700', color: colors.onAccent, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  action: { fontSize: 13, fontWeight: '800', color: colors.onAccent }
});
