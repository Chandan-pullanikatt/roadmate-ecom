// − 1 + on an accent-tinted background. The B2B restock grid is built from these.
//
// ⚠️ **The visual size and the touch size are deliberately different.** The
// control is 36 dp tall with 30 dp sides, because a stepper that met the 48 dp
// minimum *visually* would dominate a product row — Swiggy, Zomato and Blinkit
// all draw a compact stepper for the same reason. What they also do, and what
// this now does, is pad the **touch target** out to the minimum with `hitSlop`:
// 30×36 plus 9 left/right and 8 top/bottom is 48×52, comfortably over Material's
// 48 dp and iOS's 44 pt.
//
// This is the most-tapped control in the customer app. If you change the
// geometry above, re-check the arithmetic here — a miss on "+" costs a sale.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from './tokens.js';

export function QuantityStepper({ value, onChange, min = 0, max = 999, disabled }) {
  const set = (next) => {
    const clamped = Math.max(min, Math.min(max, next));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <View style={[styles.wrap, disabled && styles.disabled]}>
      <Pressable
        onPress={() => set(value - 1)}
        disabled={disabled || value <= min}
        hitSlop={{ top: 8, bottom: 8, left: 9, right: 9 }}
        style={styles.side}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
      >
        <Text style={[styles.glyph, (disabled || value <= min) && styles.glyphOff]}>−</Text>
      </Pressable>

      <Text style={styles.value}>{value}</Text>

      <Pressable
        onPress={() => set(value + 1)}
        // `max` is the shelf, not a preference: the customer app is capped at
        // `sellableQty` and the B2B grid at what the distributor holds.
        disabled={disabled || value >= max}
        hitSlop={{ top: 8, bottom: 8, left: 9, right: 9 }}
        style={[styles.side, styles.plus, (disabled || value >= max) && styles.plusOff]}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
      >
        <Text style={[styles.glyph, styles.plusGlyph]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    height: 36
  },
  disabled: { opacity: 0.5 },
  side: { width: 30, alignItems: 'center', justifyContent: 'center', height: '100%' },
  plus: { backgroundColor: colors.accent, borderRadius: radius.sm },
  plusOff: { backgroundColor: colors.accentDim },
  glyph: { fontSize: 18, fontWeight: '700', color: colors.ink },
  glyphOff: { color: colors.inkFaint },
  plusGlyph: { color: colors.onAccent },
  value: { minWidth: 32, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.ink }
});
