// The RoadMate mark, in one place, for all three apps (2026-08-11).
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// The Customer app's sign-in screen showed the client's actual logo. The Rider
// and Business sign-in screens showed **a plain yellow square** — a bare `View`
// with `backgroundColor: colors.accent`, placed as a stand-in for a mark nobody
// had wired up. Three apps that are one product to the shop owner who uses two of
// them in the same shift, and two of them opened on an unbranded swatch.
//
// The asset lives here rather than being copied into each app's `assets/` for the
// same reason the tokens do: three copies of a logo is three things to replace
// when the client sends a new one, and the one that gets missed is the one on the
// screen you look at least. Metro resolves workspace packages, so `require` from
// inside this package works in all three apps unchanged.
//
// ⚠️ **It is a 16:9 photograph of a wordmark, not a square icon.** So it is
// *framed* rather than cropped to a circle — a square crop cuts the word in half.
// `BrandMark` therefore has a landscape default; anything that needs a square
// (a launcher icon, an avatar) needs a real square export from the client, which
// is still outstanding.
import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from './tokens.js';

/** The raw asset, for a screen that wants to place it itself. */
export const LOGO = require('../assets/roadmate-logo.jpeg');

/**
 * The logo at a readable size, optionally with the app's name under it.
 *
 * @param {object} props
 * @param {number} [props.width] 168 is the sign-in size the Customer app set and
 *   the other two now match; the height follows the 16:9 ratio.
 * @param {string} [props.title] e.g. "RoadMate Rider". Rendered in
 *   `typography.screenTitle`, so the three sign-in screens agree on weight and
 *   size rather than each picking one.
 * @param {string} [props.tagline] the one-line "for delivery partners" under it.
 */
export function BrandMark({ width = 168, title, tagline }) {
  return (
    <View style={styles.wrap}>
      <Image
        source={LOGO}
        style={[styles.logo, { width, height: Math.round((width * 9) / 16) }]}
        // `contain`, not `cover`: this is a wordmark, and `cover` on a
        // non-16:9 box crops letters off the ends.
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="RoadMate"
      />
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {tagline ? <Text style={typography.meta}>{tagline}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs },
  logo: {
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    // The artwork is a black wordmark on a solid field of the brand yellow, so
    // the box behind it is that same yellow: `contain` on a box whose rounded
    // height is a pixel off 16:9 would otherwise show a hairline of page grey
    // along one edge, which reads as a rendering bug rather than as a logo.
    backgroundColor: colors.accent
  },
  title: { ...typography.screenTitle }
});
