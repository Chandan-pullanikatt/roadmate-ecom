// A gradient with no native module behind it.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
//
// The storefront pass first drew the banner cards with `expo-linear-gradient`,
// and that **broke every phone running an existing dev client**:
//
//     Can't find ViewManager 'ViewManagerAdapter_ExpoLinearGradient'
//     nor 'RCTViewManagerAdapter_ExpoLinearGradient' in ViewManagerRegistry
//
// A linear gradient is a *native view*. Adding the package puts it in the JS
// bundle immediately and in the APK only after a new native build — so an
// over-the-air JS reload references a view manager the installed binary has
// never heard of, and the screen dies at the first banner. Everyone testing on
// an already-installed build has to reinstall before they can open the app.
//
// This is the same call HANDOFF §6 already records for the rider's signature
// capture: **the answer was vector SVG rather than adding `react-native-svg` and
// `react-native-view-shot` to six builds.** A decorative background is nowhere
// near worth a native dependency and a forced reinstall across three codebases.
//
// ── HOW IT WORKS, AND WHY THE SEAMS DO NOT SHOW ───────────────────────────────
//
// N bands in a flex row, each interpolated between the two endpoint colours.
// `flex: 1` rather than percentage widths is load-bearing: a fractional percent
// leaves sub-pixel hairlines between siblings on some densities, and a striped
// banner is far more obviously wrong than a slightly stepped one.
//
// At 24 bands across a ~360 dp card each band is ~15 dp, and the largest channel
// step in any palette here is about 4/255 — under the ~2% difference the eye can
// resolve on a large flat area, and well under what an LCD at this size will
// show. The banner is a soft pastel wash, not a photographic sky; this is the
// one case where the cheap approximation is genuinely indistinguishable.
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';

/** '#RRGGBB' → [r, g, b]. Also accepts the three-digit form. */
function parseHex(hex) {
  let value = String(hex).replace('#', '').trim();
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const n = Number.parseInt(value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** The colour `t` of the way from `a` to `b`, where t is 0..1. */
function mix(a, b, t) {
  const [r1, g1, b1] = a;
  const [r2, g2, b2] = b;
  return `#${toHex(r1 + (r2 - r1) * t)}${toHex(g1 + (g2 - g1) * t)}${toHex(b1 + (b2 - b1) * t)}`;
}

/**
 * @param {object} props
 * @param {[string, string]} props.colors  the two endpoints, as hex
 * @param {'horizontal'|'vertical'} [props.direction]
 * @param {number} [props.steps]  bands. More is smoother and more views; 24 is
 *   already past the point where the difference is visible at card size.
 * @param {number} [props.radius]  rounds the gradient's own outer corners.
 *
 *   ⚠️ **Use this rather than `overflow: 'hidden'` on the parent.** On Android a
 *   rounded view that clips its children uses a `ViewOutlineProvider`: at a
 *   radius of half the box or more that resolves to a plain oval — the reliable
 *   fast path — and below it to an arbitrary path clip, which combined with
 *   `elevation` drops non-image children on re-render. That bug ate the artwork
 *   out of the industry rail (`apps/consumer/src/components/TaxonomyRail.js`),
 *   and a banner card carries the highest elevation in the app.
 *
 *   Nothing needs clipping here anyway: for a horizontal gradient only the first
 *   and last band touch a corner, so they round themselves and every band
 *   between them is square because its edges are straight.
 * @param {object} [props.style]  applied to the container.
 */
export function Gradient({ colors, direction = 'horizontal', steps = 24, radius = 0, style, children }) {
  const [from, to] = colors ?? [];
  const vertical = direction === 'vertical';

  const bands = useMemo(() => {
    if (!from || !to) return [];
    const a = parseHex(from);
    const b = parseHex(to);
    // steps - 1 in the denominator so the last band is exactly `to` rather than
    // stopping one step short of it — otherwise a two-colour gradient never
    // actually reaches the colour it was asked for.
    return Array.from({ length: steps }, (_, i) => mix(a, b, steps === 1 ? 0 : i / (steps - 1)));
  }, [from, to, steps]);

  return (
    <View style={style}>
      <View
        style={[StyleSheet.absoluteFill, { flexDirection: vertical ? 'column' : 'row' }]}
        // The bands are decoration. Without this a screen reader walks 24 empty
        // views before reaching the headline sitting on top of them.
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {bands.map((color, index) => {
          // Only the two end bands touch a corner. Written as explicit corner
          // properties rather than `borderRadius`, so a band never rounds an
          // edge that is in the middle of the gradient.
          const first = index === 0;
          const last = index === bands.length - 1;
          const corners = radius
            ? vertical
              ? {
                  borderTopLeftRadius: first ? radius : 0,
                  borderTopRightRadius: first ? radius : 0,
                  borderBottomLeftRadius: last ? radius : 0,
                  borderBottomRightRadius: last ? radius : 0
                }
              : {
                  borderTopLeftRadius: first ? radius : 0,
                  borderBottomLeftRadius: first ? radius : 0,
                  borderTopRightRadius: last ? radius : 0,
                  borderBottomRightRadius: last ? radius : 0
                }
            : null;

          return <View key={index} style={[{ flex: 1, backgroundColor: color }, corners]} />;
        })}
      </View>
      {children}
    </View>
  );
}
