// The small pieces every RoadMate screen is assembled from (HANDOFF §5):
// white cards with a soft shadow, status pills, section headers, chips.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography, shadow, statusTone, toneColors } from './tokens.js';

/**
 * White, ~12px radius, soft shadow, generous padding.
 *
 * ⚠️ **Two branches, not one container with a shared style prop** (fixed
 * 2026-08-12). This used to pick `Pressable` or `View` and hand both the same
 * *function* style — `({ pressed }) => [...]`. Only `Pressable` supports that
 * form. A `View` given a function silently renders with **no style at all**, so
 * every non-pressable Card in all three apps lost its background, radius, shadow
 * and padding — and, worse, silently dropped whatever `style` its caller passed.
 *
 * It failed quietly for two reasons: most Cards on the busy screens *do* take an
 * `onPress`, so the ones that worked were the ones people looked at; and a card
 * with no background on a near-white page just looks like flat layout rather
 * than like a bug. It surfaced on the Restock grid, where the dropped style was
 * the tile's **width** and the two-column list ran off the side of the screen.
 */
export function Card({ children, style, onPress, ...rest }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

/**
 * The fix for the `Card` bug above, in the form the other `onPress ? Pressable :
 * View` components need — `StatTile`, `ListRow` and `OrderCard` all had the
 * identical defect and were found by looking for it on 2026-08-12.
 *
 * Those three define one style *function* and hand it to whichever container
 * they picked. React Native's function form is a `Pressable` feature: a `View`
 * given a function renders with **no style at all**. So every non-pressable
 * `StatTile` — which is most of them, on every home screen in all three apps —
 * lost its white background, its radius, its padding and its shadow, and drew as
 * bare text on the page. It reads as a slightly plain design rather than as a
 * bug, which is why it survived a polish pass.
 *
 * Keeping one style function and *calling* it for the `View` branch, rather than
 * writing the array out twice, is deliberate: two copies is how the pressed and
 * unpressed forms drift.
 *
 * @param {(state: {pressed?: boolean}) => any} fn the component's style function
 * @param {boolean} pressable whether the container is a `Pressable`
 */
export const containerStyle = (fn, pressable) => (pressable ? fn : fn({ pressed: false }));

export function SectionHeader({ title, action, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={typography.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The status pill on the right of every list row.
 *
 * Takes the raw API status and colours itself, so no screen ever hardcodes
 * "DELIVERED is green" — `statusTone` in tokens.js is the single mapping, and it
 * covers both the B2C and the B2B status vocabularies.
 */
export function StatusPill({ status, label, tone }) {
  const { bg, fg } = toneColors(tone ?? statusTone(status));
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>
        {label ?? prettyStatus(status)}
      </Text>
    </View>
  );
}

/** "PICKED" → "Picked". B2B statuses are already title-case and pass through. */
export function prettyStatus(status) {
  if (!status) return '';
  const s = String(status);
  return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

/**
 * The filter chips above a product grid — and, in the Customer app, the seven
 * industries.
 *
 * ⚠️ Same visual-size-vs-touch-size split as `QuantityStepper`: a chip draws at
 * ~34 dp because a row of 48 dp chips reads as a row of buttons, but `hitSlop`
 * takes the tappable area to 48. Chips sit in a horizontal scroller, where a
 * near-miss scrolls the row instead of selecting — the worst failure mode a
 * filter can have.
 */
export function Chip({ label, icon, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 7, bottom: 7, left: 2, right: 2 }}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
    >
      {icon}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/** The small grey caps line above a product name. */
export const Sku = ({ children }) =>
  children ? <Text style={typography.sku}>{String(children).toUpperCase()}</Text> : null;

export const Divider = () => <View style={styles.divider} />;

/**
 * What a list shows when it is empty — always with a reason, never a blank
 * screen. A shop staring at an empty offers list needs to know whether that is
 * "no orders yet" or "you are closed".
 */
export function EmptyState({ title, message, action }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action}
    </View>
  );
}

/** A label/value row, used by every bill panel and detail sheet. */
export function KeyValue({ label, value, strong }) {
  return (
    <View style={styles.kv}>
      <Text style={[typography.body, strong && styles.kvStrong, { color: strong ? colors.ink : colors.inkMuted }]}>
        {label}
      </Text>
      <Text style={[strong ? typography.money : typography.body, styles.kvValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    ...shadow
  },
  pressed: { opacity: 0.85 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md
  },
  sectionAction: { fontSize: 13, fontWeight: '600', color: colors.inkMuted },

  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start'
  },
  pillText: { fontSize: 11, fontWeight: '700' },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  chipTextSelected: { color: colors.onAccent },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyTitle: { ...typography.sectionTitle, textAlign: 'center' },
  emptyMessage: { ...typography.meta, textAlign: 'center', lineHeight: 18 },

  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvStrong: { fontWeight: '700' },
  // Money is bold and right-aligned (HANDOFF §5).
  kvValue: { textAlign: 'right' }
});
