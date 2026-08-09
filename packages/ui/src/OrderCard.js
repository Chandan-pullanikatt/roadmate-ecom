// The order row exactly as the designs draw it (`designs/Partner.png`, screen 3):
//
//   #RM-8231 • Kannan Motors                    [Dispatched]
//   25 Jul, 9:14 AM • 4 items
//   ──────────────────────────────────────────────────────────
//   ₹7,940                                         Details ›
//
// Not a `ListRow`. `ListRow` stacks the pill and the money in a right-hand
// column, which squeezes both and puts the amount — the thing a partner scans a
// list for — in the smallest type on the row. The design gives money its own
// line at the bottom left, bold, with the affordance opposite it. That reading
// order (who, when, how it's going, how much) is why this is its own component
// rather than another `ListRow` variant.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography, shadow } from './tokens.js';
import { StatusPill } from './primitives.js';

/**
 * @param {string} title   "#RM-8231 • Kannan Motors"
 * @param {string} meta    "25 Jul, 9:14 AM • 4 items"
 * @param {string} status  raw API status — `StatusPill` colours it
 * @param {string} amount  already formatted; this component never touches money
 * @param {node}   [footer] replaces the amount row entirely (a countdown, say)
 * @param {string} [action] the bottom-right affordance, default "Details"
 */
export function OrderCard({ title, meta, status, statusLabel, statusTone, amount, action = 'Details', onPress, footer, children, style }) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed } = {}) => [styles.card, pressed && styles.pressed, style]}
    >
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {meta ? <Text style={typography.meta}>{meta}</Text> : null}
        </View>
        {status || statusLabel ? <StatusPill status={status} label={statusLabel} tone={statusTone} /> : null}
      </View>

      {children}

      {footer ?? (amount !== undefined ? (
        <>
          <View style={styles.rule} />
          <View style={styles.foot}>
            <Text style={typography.money}>{amount}</Text>
            {onPress ? <Text style={styles.action}>{action} ›</Text> : null}
          </View>
        </>
      ) : null)}
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow
  },
  pressed: { opacity: 0.85 },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink },

  rule: { height: 1, backgroundColor: colors.border, marginTop: spacing.xs },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  action: { fontSize: 13, fontWeight: '600', color: colors.inkMuted }
});
