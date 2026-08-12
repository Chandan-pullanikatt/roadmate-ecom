// The designed settings/detail list: one white card, hairline rules between the
// rows, a chevron on any row that goes somewhere.
//
// `designs/Partner.png`'s Profile screen is the reference — "Business" and
// "Preferences" are two grouped cards under small bold labels, not two stacks of
// separate cards. The distinction matters: separate cards read as separate
// things, and "Buyer / Seller / Industry" on an order is one thing.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography, shadow } from './tokens.js';
import { containerStyle } from './primitives.js';

/** The card. Children are `GroupedRow`s; the rules between them are automatic. */
export function GroupedCard({ children, style }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, style]}>
      {rows.map((row, i) => (
        <View key={row.key ?? i} style={i > 0 && styles.ruled}>
          {row}
        </View>
      ))}
    </View>
  );
}

/**
 * A row in a `GroupedCard`.
 *
 * @param {string} label     left, ink
 * @param {string} [value]   right, muted — the current setting or figure
 * @param {node}   [right]   overrides `value` for a pill or a switch
 * @param {func}   [onPress] adds the chevron; without it the row is not tappable
 */
export function GroupedRow({ label, sublabel, value, right, onPress, tone }) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      // Fourth instance of the `Card` bug (2026-08-12): a non-tappable grouped
      // row — the Profile screen's plain fact rows — was losing `flexDirection`
      // and its padding, so its label and value stacked instead of sitting
      // opposite each other.
      style={containerStyle(({ pressed } = {}) => [styles.row, pressed && styles.pressed], Boolean(onPress))}
    >
      <View style={styles.rowBody}>
        <Text style={[typography.body, tone === 'danger' && { color: colors.danger }]} numberOfLines={2}>
          {label}
        </Text>
        {sublabel ? <Text style={typography.meta}>{sublabel}</Text> : null}
      </View>
      {right ?? (value !== undefined && value !== null ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null)}
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    ...shadow
  },
  ruled: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { opacity: 0.85 },

  // ⚠️ **The label and the value share one line, and this is written to make that
  // impossible to lose.** On a device these were rendering stacked — label on one
  // line, value right-aligned on the next — which made every settings list in
  // three apps look like an unstyled dump.
  //
  // `justifyContent: 'space-between'` is what actually places them, rather than
  // relying on the body's `flex: 1` to push the value over: a `flex: 1` child
  // claims *all* the free space, so the value is left with whatever is over and
  // is one long label away from being squeezed to nothing. The body now shrinks
  // instead of growing, and the value is capped rather than compressible, so
  // neither can push the other off the line.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.md
  },
  // `minWidth: 0` is load-bearing on a shrinkable flex child: without it the
  // child's intrinsic content width is its floor and it refuses to shrink,
  // which is exactly how a row overflows and wraps.
  rowBody: { flexShrink: 1, minWidth: 0, gap: 2 },
  value: {
    ...typography.body,
    color: colors.inkMuted,
    textAlign: 'right',
    // Never squeezed to nothing by a long label, never wider than half the row.
    flexShrink: 0,
    maxWidth: '55%'
  },
  chevron: { fontSize: 20, color: colors.inkFaint, marginLeft: spacing.xs }
});
