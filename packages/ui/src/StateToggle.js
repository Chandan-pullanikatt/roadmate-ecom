// The switch that decides whether the platform sends you work.
//
// ── WHY THIS IS ONE COMPONENT AND NOT TWO SCREENS ───────────────────────────
//
// Two apps have this control and it means exactly the same thing in both:
//
//   • Rider, "on shift"  — off, you are invisible to `freeRidersNear()` and you
//     do not count towards `hasRiderCoverage()`, so the shops around you can
//     stop being serviceable at all.
//   • Shop, "open"       — closed, `rankCandidateShops()` does not consider you,
//     so no customer order can reach you however well stocked you are.
//
// Same stakes, same question ("am I earning right now?"), same glance from
// across a counter or a handlebar. They were two separate implementations that
// had already drifted — different border weights, different copy structure, and
// the rider's had an accent border while the shop's had none — which is the drift
// this package exists to prevent. One component means the shop owner who also
// rides, or the operator demoing both, sees one product.
//
// ── THE VISUAL DECISION ─────────────────────────────────────────────────────
//
// **On is a filled accent wash; off is a plain card.** Before 2026-08-11 both
// were white cards distinguished by a 1.5 px border, i.e. the same visual weight
// as every other card on the page — the most important control in each app was
// identifiable only by reading it. The fill is legible at arm's length in
// sunlight, which is the real viewing condition for both audiences.
//
// The switch track inverts to ink on the wash, because a yellow track on a yellow
// card is invisible, and this is the one control that must never be.
//
// ⚠️ `Gradient` rather than `expo-linear-gradient`: a native view would break
// every installed dev client until it was rebuilt. See `Gradient.js`.
import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography, shadowLift } from './tokens.js';
import { Gradient } from './Gradient.js';

/**
 * @param {object} props
 * @param {boolean} props.on
 * @param {(next: boolean) => void} props.onChange
 * @param {boolean} [props.disabled] while the server is being asked
 * @param {string} props.titleOn  e.g. "You are on shift" / "Shop is open"
 * @param {string} props.titleOff
 * @param {string} props.metaOn   what being on actually causes
 * @param {string} props.metaOff  what being off actually costs
 */
export function StateToggle({ on, onChange, disabled, titleOn, titleOff, metaOn, metaOff }) {
  return (
    <View style={styles.wrap}>
      {on ? (
        <Gradient
          colors={[colors.accentDim, colors.accent]}
          direction="horizontal"
          radius={radius.md}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[styles.row, !on && styles.off]}>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            {/* A dot, not an icon. "Live" is a state, and the green-dot convention
                is read faster than any glyph — and needs no font to render. */}
            <View style={[styles.dot, on ? styles.dotOn : styles.dotOff]} />
            <Text style={styles.title}>{on ? titleOn : titleOff}</Text>
          </View>
          <Text style={[typography.meta, on && styles.metaOn]}>{on ? metaOn : metaOff}</Text>
        </View>
        <Switch
          value={on}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ true: colors.ink, false: colors.border }}
          thumbColor={colors.card}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The wrap carries the corner and the lift; the gradient sits inside it
  // absolutely and the content on top. No `overflow: 'hidden'` — on Android that
  // drops non-image children of an elevated rounded view (see `Gradient.js`).
  wrap: { borderRadius: radius.md, ...shadowLift },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.lg
  },
  off: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  text: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink },
  // `inkMuted` was picked against white and goes muddy on the accent wash, so the
  // "on" meta gets its own darker warm grey rather than reusing the token.
  metaOn: { color: '#4A4123' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotOn: { backgroundColor: colors.success },
  dotOff: { backgroundColor: colors.inkFaint }
});
