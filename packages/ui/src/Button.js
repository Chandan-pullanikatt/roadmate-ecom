// Buttons. Accent-filled is the primary action; there is exactly one per screen.
import React from 'react';
import { Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, radius } from './tokens.js';

/**
 * @param {'primary'|'secondary'|'danger'|'ghost'} variant
 *
 * `loading` disables the button as well as spinning it — every destructive verb
 * in this app (accept, reject, remit, redeem) is a claim on the server, and a
 * second tap while the first is in flight is the classic way to get a confusing
 * 409 the user did nothing to deserve.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  icon,
  accessibilityLabel
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      // Required for an icon-only button, which has no text to announce.
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.inkMuted} />
      ) : (
        <>
          {icon}
          {/* ⚠️ `numberOfLines={1}`, always. A label is a verb, and a verb broken
              across two lines ("Remo / ve") is the single most obviously-unfinished
              thing a screen can show — it happened on the executive Products grid,
              where two flex:1 buttons in a 158 dp tile leave ~47 dp of text width
              and "Remove" needs ~55. Wrapping also silently grows the button,
              which is how one tile in a row ends up taller than its neighbour.

              This clamps the symptom. A label that does not fit is still a layout
              bug and the fix is a shorter label or an icon-only button — see
              `ProductTile` in `app/(exec)/products.js`, which does the latter. */}
          {label ? (
            <Text style={[styles.label, styles[`${variant}Label`]]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  label: { fontSize: 15, fontWeight: '700' },

  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent },

  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  secondaryLabel: { color: colors.ink },

  // Red is "cancelled / log out" in HANDOFF §5, and it is outlined rather than
  // filled — a shop rejecting an order is a normal action, not a scary one.
  danger: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger },
  dangerLabel: { color: colors.danger },

  // 44, not 40: iOS HIG's minimum touch target is 44 pt, and a ghost button is
  // still a button. It stays shorter than the 48 of the filled variants because
  // it is the quieter action on the screen — but not so short that it is harder
  // to hit than the thing it sits next to.
  ghost: { backgroundColor: 'transparent', minHeight: 44 },
  ghostLabel: { color: colors.inkMuted }
});
