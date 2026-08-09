// An inline strip above the content: "no connection", "showing what we last
// saw", "this list is stale".
//
// It exists for a specific hole. `useResource` deliberately keeps the last good
// data on screen when a background poll fails (a shop watching a countdown must
// not lose the order because one request timed out) — but until now **no screen
// rendered `error` at all** when it already had data. The result was a list that
// silently stopped updating and looked fine, which on the offers screen means a
// shop calmly watching a countdown that is no longer connected to anything.
//
// So: never a modal, never a blocking error, never over the top of the data.
// A strip that says the screen is not live any more, and what to do about it.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from './tokens.js';

/**
 * @param {'warning'|'danger'|'info'} [tone]
 * @param {string} [action] label for an optional trailing button ("Retry")
 */
export function Banner({ message, tone = 'warning', action, onAction, icon }) {
  const palette = TONES[tone] ?? TONES.warning;
  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg, borderColor: palette.fg }]}>
      <Text style={styles.icon}>{icon ?? palette.icon}</Text>
      <Text style={[styles.message, { color: colors.ink }]} numberOfLines={3}>
        {message}
      </Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.action, { color: palette.fg }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The standard reading of a `useResource` error, so no screen has to invent its
 * own wording for "the network is down".
 */
export function connectionMessage(error) {
  if (!error) return null;
  if (error.isNetwork) return 'No connection — showing the last thing we saw.';
  if (error.isAuth) return 'Your session expired. Sign in again.';
  return error.message || 'Something went wrong refreshing this screen.';
}

const TONES = {
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: '!' },
  danger: { bg: colors.dangerSoft, fg: colors.danger, icon: '!' },
  info: { bg: colors.infoSoft, fg: colors.info, icon: 'i' }
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  icon: { fontSize: 13, fontWeight: '800', color: colors.ink, width: 14, textAlign: 'center' },
  message: { ...typography.meta, flex: 1, lineHeight: 17 },
  action: { fontSize: 13, fontWeight: '700' }
});
