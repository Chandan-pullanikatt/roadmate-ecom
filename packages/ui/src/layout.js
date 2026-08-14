// The screen furniture from HANDOFF §5: the greeting header, the stat-tile grid,
// the quick-action row, and the list row every list is made of.
import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography, shadow, toneColors } from './tokens.js';
import { containerStyle } from './primitives.js';
import { sizedImage } from './image.js';
import { Icon, ICONS } from './Icon.js';

/** Initials from a business name — "Sri Krishna Auto Parts" → "SK". */
export function initialsOf(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export function Avatar({ name, size = 40 }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initialsOf(name)}</Text>
    </View>
  );
}

/**
 * Greeting header: avatar + greeting + business name on the left, a bell on the
 * right with an unread dot.
 *
 * `subtitle` is optional and sits under the name — who this account *is*
 * ("Distributor · Ernakulam"), which is the one thing a field executive needs to
 * see when four business apps look alike and they are holding somebody else's
 * phone. Additive: every existing caller renders exactly as before.
 */
export function GreetingHeader({ name, greeting, subtitle, onBellPress, hasAlerts }) {
  return (
    <View style={styles.greeting}>
      <Avatar name={name} />
      <View style={styles.greetingText}>
        <Text style={typography.meta}>{greeting ?? timeGreeting()}</Text>
        <Text style={styles.greetingName} numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text style={styles.greetingSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable onPress={onBellPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="Alerts">
        <View style={styles.bell}>
          {/* Was a 🔔 emoji. Emoji at least render, unlike the Unicode glyphs the
              stat tiles used, but they are full-colour cartoons in a monochrome
              header and they differ on every OS version — so the header looked
              slightly different on every handset. */}
          <Icon name="alerts" size={20} color={colors.inkMuted} />
          {hasAlerts ? <View style={styles.bellDot} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

export function timeGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The 2×2 / 3×2 stat grid under the greeting. */
export function StatGrid({ children }) {
  return <View style={styles.statGrid}>{children}</View>;
}

/**
 * One figure, in the grid under the greeting.
 *
 * Two things were wrong with this until 2026-08-11, and both were invisible in
 * code review because they are absences rather than mistakes:
 *
 *   1. **`icon` was rendered as text**, so callers passed Unicode characters —
 *      `₹ ✓ ⛁ ⊘ ⏱`. `⛁` (U+26C1) and `⊘` (U+2298) are outside the subset many
 *      Android system fonts ship, so on a real handset they are **tofu boxes**.
 *      `icon` now names a concept from `ICONS`; a raw string is still accepted so
 *      nothing breaks mid-migration, but it is the fallback, not the path.
 *
 *   2. **`tone` only did anything for `'danger'`.** Every `tone="success"` and
 *      `tone="warning"` on every screen silently rendered as plain ink — the
 *      caller had asked for emphasis, the tile had agreed, and nothing happened.
 *      The tone now colours the icon's badge, which is where colour belongs: a
 *      whole figure in green reads as a state, a green badge beside it reads as a
 *      category, and "cash in hand" is a category.
 */
export function StatTile({ label, value, icon, tone, onPress, style }) {
  const Container = onPress ? Pressable : View;
  // `neutral` from `toneColors` is the page grey, which is what an untinted badge
  // should be — so an absent tone needs no branch.
  const { bg, fg } = toneColors(tone ?? 'neutral');
  const named = typeof icon === 'string' && ICONS[icon];

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      // ⚠️ `containerStyle`, not the bare function — see its comment in
      // primitives.js. A `View` handed a style *function* renders with no style,
      // so until 2026-08-12 every stat tile without an `onPress` drew as bare
      // text on the page with no card behind it.
      style={containerStyle(({ pressed } = {}) => [styles.statTile, pressed && { opacity: 0.85 }, style], Boolean(onPress))}
    >
      {icon ? (
        <View style={[styles.statBadge, { backgroundColor: bg }]}>
          {named ? (
            <Icon name={icon} size={15} color={fg} />
          ) : (
            // A glyph a caller still passes directly. Kept so an un-migrated
            // screen degrades to what it looked like before rather than to a gap.
            <Text style={[styles.statGlyph, { color: fg }]}>{icon}</Text>
          )}
        </View>
      ) : null}
      <Text style={typography.meta} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.statValue, tone === 'danger' && { color: colors.danger }]}
        numberOfLines={1}
        // Money and counts are read at a glance from a moving bike; letting the
        // OS shrink them one step is better than truncating to an ellipsis.
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {value}
      </Text>
    </Container>
  );
}

/**
 * The "Quick Actions" icon row.
 *
 * `item.icon` names a concept from `ICONS`, as everywhere else. It used to be a
 * literal character and the callers passed `▤ ▦ 🤝 ☺ ⇄ 🎟` — a mix of Unicode box
 * drawings that go tofu on some Android font stacks and colour emoji that do not,
 * side by side in one row, which is why the row never looked like a set.
 */
export function QuickActions({ items }) {
  return (
    <View style={styles.quickRow}>
      {items.map((item) => (
        <Pressable
          key={item.label}
          onPress={item.onPress}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          style={({ pressed }) => [styles.quickItem, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.quickIcon}>
            {ICONS[item.icon] ? (
              <Icon name={item.icon} size={24} color={colors.ink} />
            ) : (
              <Text style={styles.quickGlyph}>{item.icon}</Text>
            )}
          </View>
          <Text style={styles.quickLabel} numberOfLines={2}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The list row: thumbnail left, title + meta stacked, status pill (or anything
 * else) right.
 */
export function ListRow({ image, title, meta, subtitle, right, onPress, style }) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      onPress={onPress}
      // Same fix as `StatTile` — a non-pressable row was losing its
      // `flexDirection: 'row'` *and* the caller's `style`, which is where the
      // divider between rows lives.
      style={containerStyle(({ pressed } = {}) => [styles.row, pressed && { opacity: 0.85 }, style], Boolean(onPress))}
    >
      {image !== undefined ? (
        <View style={styles.thumb}>
          {image ? (
            <Image
              source={{ uri: sizedImage(image, { width: 52, height: 52, crop: 'fit' }) }}
              style={styles.thumbImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      ) : null}
      <View style={styles.rowBody}>
        {subtitle ? <Text style={typography.sku}>{subtitle}</Text> : null}
        <Text style={typography.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        {meta ? <Text style={typography.meta}>{meta}</Text> : null}
      </View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </Container>
  );
}

const styles = StyleSheet.create({
  greeting: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  greetingText: { flex: 1 },
  greetingName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  greetingSubtitle: { ...typography.sku, marginTop: 1 },
  avatar: { backgroundColor: colors.infoSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: colors.info },
  bell: { padding: spacing.xs },
  bellDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger
  },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statTile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
    ...shadow
  },
  statBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs
  },
  statGlyph: { fontSize: 14, fontWeight: '700' },
  statValue: { fontSize: 22, fontWeight: '700', color: colors.ink },

  quickRow: { flexDirection: 'row', gap: spacing.md },
  quickItem: { flex: 1, alignItems: 'center', gap: spacing.sm },
  quickIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow
  },
  quickGlyph: { fontSize: 22 },
  quickLabel: { ...typography.meta, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.page,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  thumbImage: { width: '100%', height: '100%' },
  rowBody: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs }
});
