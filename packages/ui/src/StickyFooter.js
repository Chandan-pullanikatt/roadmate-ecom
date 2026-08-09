// The pinned action bar — the designs' full-width "Payment" button, sitting on
// the bottom edge rather than at the end of a scroll.
//
// The reason it is pinned matters on these screens specifically: the shop's
// order detail and the executive's status ladder each have exactly **one**
// forward action, and on a long order it was below the fold. An action you have
// to scroll to find is an action that gets taken late, and on the shop's side
// late means the customer's promised ETA is already burning.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing } from './tokens.js';

export function StickyFooter({ children, style }) {
  return <View style={[styles.bar, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    // Lifts off the list scrolling under it. Upward shadow, so it reads as a
    // layer above the content rather than a card sitting in it.
    shadowColor: '#0B1220',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8
  }
});
