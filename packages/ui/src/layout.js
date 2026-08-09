// The screen furniture from HANDOFF §5: the greeting header, the stat-tile grid,
// the quick-action row, and the list row every list is made of.
import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography, shadow } from './tokens.js';

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
 */
export function GreetingHeader({ name, greeting, onBellPress, hasAlerts }) {
  return (
    <View style={styles.greeting}>
      <Avatar name={name} />
      <View style={styles.greetingText}>
        <Text style={typography.meta}>{greeting ?? timeGreeting()}</Text>
        <Text style={styles.greetingName} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Pressable onPress={onBellPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="Alerts">
        <View style={styles.bell}>
          <Text style={styles.bellGlyph}>🔔</Text>
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

export function StatTile({ label, value, icon, tone, onPress }) {
  const Container = onPress ? Pressable : View;
  return (
    <Container onPress={onPress} style={({ pressed } = {}) => [styles.statTile, pressed && { opacity: 0.85 }]}>
      {icon ? <Text style={styles.statIcon}>{icon}</Text> : null}
      <Text style={typography.meta} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, tone === 'danger' && { color: colors.danger }]} numberOfLines={1}>
        {value}
      </Text>
    </Container>
  );
}

/** The "Quick Actions" icon row. */
export function QuickActions({ items }) {
  return (
    <View style={styles.quickRow}>
      {items.map((item) => (
        <Pressable key={item.label} onPress={item.onPress} style={styles.quickItem}>
          <View style={styles.quickIcon}>
            <Text style={styles.quickGlyph}>{item.icon}</Text>
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
    <Container onPress={onPress} style={({ pressed } = {}) => [styles.row, pressed && { opacity: 0.85 }, style]}>
      {image !== undefined ? (
        <View style={styles.thumb}>
          {image ? <Image source={{ uri: image }} style={styles.thumbImage} resizeMode="contain" /> : null}
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
  avatar: { backgroundColor: colors.infoSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: colors.info },
  bell: { padding: spacing.xs },
  bellGlyph: { fontSize: 18 },
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
  statIcon: { fontSize: 16, marginBottom: spacing.xs },
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
