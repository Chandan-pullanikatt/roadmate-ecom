// The yellow header — where the order is going, and the two things you can do
// from anywhere (the storefront pass, 2026-08-10).
//
// **The address is the control, not a caption.** It is the one field on the home
// screen that changes every answer below it: serviceability, which shops rank,
// the ETA on every card, and whether the order can be placed at all. It used to
// be a white card halfway down the screen, indistinguishable from the content it
// governs. Here it is the first thing, in the accent, with a chevron — the same
// place and the same shape every quick-commerce app in India puts it, because
// that is where people have learned to look for it.
//
// It draws its own status-bar inset rather than sitting inside a SafeAreaView,
// because the colour has to run to the top edge of the glass. A safe-area gap
// above an accent bar reads as a rendering bug on every phone with a notch.
//
// ⚠️ **The design's heart icon is deliberately not here.** `designs/Customer.png`
// puts a wishlist button next to the cart, and there is no wishlist anywhere on
// this platform — no model, no endpoint, nothing to save a product *to*. Drawing
// it would be the disabled-camera-button mistake the Rider and Customer apps
// each already refused to make (HANDOFF §6, Phases 3 and 4): an affordance that
// cannot work is worse than one that is absent, and a heart that does nothing on
// tap is worse still because it looks like it saved something. It goes in the
// moment `Wishlist` exists; until then the cart has the bar to itself.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, shadow } from '@roadmate/ui';

/**
 * @param {object} props
 * @param {string} props.place        what to show as the destination
 * @param {string} [props.caption]    the small line above it
 * @param {() => void} props.onPlace  opens the address book
 * @param {() => void} props.onCart
 * @param {number} [props.cartCount]  badge; 0 renders no badge
 */
export default function AppBar({ place, caption = 'Delivery to', onPlace, onCart, cartCount = 0 }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable
        onPress={onPlace}
        style={styles.place}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Delivering to ${place}. Change address.`}
      >
        <Ionicons name="location-sharp" size={20} color={colors.onAccent} style={styles.pin} />
        <View style={styles.placeText}>
          <Text style={styles.caption}>{caption}</Text>
          <View style={styles.placeRow}>
            {/* One line, ellipsised. A wrapping address pushes the icons off the
                bar and changes the header's height between screens. */}
            <Text style={styles.placeName} numberOfLines={1}>
              {place}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.onAccent} />
          </View>
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          onPress={onCart}
          style={styles.action}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cartCount ? `Cart, ${cartCount} items` : 'Cart'}
        >
          <Ionicons name="cart-outline" size={20} color={colors.onAccent} />
          {cartCount > 0 ? (
            <View style={styles.badge}>
              {/* 9+ rather than a three-digit badge that resizes the button. */}
              <Text style={styles.badgeText}>{cartCount > 9 ? '9+' : cartCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  place: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  pin: { marginTop: 2 },
  placeText: { flex: 1 },
  // 80% ink rather than a lighter grey: on a mid-tone yellow, grey text loses
  // contrast in both directions at once.
  caption: { fontSize: 11, fontWeight: '600', color: 'rgba(26,26,26,0.72)', letterSpacing: 0.2 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  placeName: { fontSize: 15, fontWeight: '700', color: colors.onAccent, flexShrink: 1 },

  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.card
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' }
});
