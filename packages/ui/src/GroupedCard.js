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
      style={({ pressed } = {}) => [styles.row, pressed && styles.pressed]}
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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.md
  },
  rowBody: { flex: 1, gap: 2 },
  value: { ...typography.body, color: colors.inkMuted, textAlign: 'right', flexShrink: 1 },
  chevron: { fontSize: 20, color: colors.inkFaint, marginLeft: spacing.xs }
});
