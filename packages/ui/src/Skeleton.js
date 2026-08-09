// Loading placeholders.
//
// Every list in this app previously rendered *nothing* while its first fetch was
// in flight — `ListEmptyComponent` was `null` when loading, on purpose, because
// showing "no orders" to a shop that has orders is worse than showing nothing.
// But nothing is its own lie: a shop opening the Orders tab on a slow connection
// sees a blank screen and taps again.
//
// A skeleton says "there is something here and it is coming", which is the true
// statement, and it holds the layout so the content does not jump when it lands.
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, spacing, radius, shadow } from './tokens.js';

/** A single shimmering block. Width may be a number or a percentage string. */
export function Skeleton({ width = '100%', height = 12, radius: r = radius.sm, style }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      // Not announced: a screen reader should hear the real content when it
      // arrives, not "loading" three times per row.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: r, backgroundColor: colors.border, opacity: pulse }, style]}
    />
  );
}

/** The shape of a `ListRow`: thumb, two stacked lines, a value on the right. */
export function SkeletonRow({ thumb = false }) {
  return (
    <View style={styles.row}>
      {thumb ? <Skeleton width={52} height={52} radius={radius.sm} /> : null}
      <View style={styles.rowBody}>
        <Skeleton width="60%" height={13} />
        <Skeleton width="35%" height={10} />
      </View>
      <Skeleton width={54} height={13} />
    </View>
  );
}

/** `count` skeleton rows inside the card they will become. */
export function SkeletonCard({ count = 3, thumb = false }) {
  return (
    <View style={styles.card}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} thumb={thumb} />
      ))}
    </View>
  );
}

/** The stat-tile grid, before the numbers arrive. */
export function SkeletonTiles({ count = 3 }) {
  return (
    <View style={styles.tiles}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.tile}>
          <Skeleton width="70%" height={10} />
          <Skeleton width="45%" height={20} />
        </View>
      ))}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowBody: { flex: 1, gap: spacing.sm },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow
  }
});
