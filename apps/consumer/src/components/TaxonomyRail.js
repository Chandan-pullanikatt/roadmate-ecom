// The two rails at the top of the storefront: industries, and the category row
// under the banner (the storefront pass, 2026-08-10).
//
// One component for both, because they are the same object — a tinted tile, a
// picture, a label, a selected state — at two sizes. Two components would be two
// places to fix the day the tile's radius changes, and they would drift within a
// release.
//
// **The picture is `artFor`'s answer, not this component's.** An uploaded
// `iconUrl` renders as a photograph; everything else renders the app's own glyph
// on a tinted tile (`src/art.js` explains why that is not the deleted Unsplash
// backfill). This file only knows how to draw whichever one it is handed, which
// is what lets the client replace one tile from the Master dashboard without a
// release and without a second layout.
import React from 'react';
import { View, Text, Image, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, radius, shadow, VectorIcon, tileInk, sizedImage } from '@roadmate/ui';
import { artFor } from '../art.js';

/**
 * @param {object} props
 * @param {Array} props.items          rows with {id, name, slug, iconUrl}
 * @param {number|null} props.selectedId
 * @param {(id: number|null) => void} props.onSelect
 * @param {'industry'|'category'} [props.kind]
 * @param {string} [props.allLabel]    when set, a leading "everything" tile.
 *   Selecting it passes `null` — "no filter" is the absence of a category, not a
 *   category, which is why the server never returns a row for it.
 */
export default function TaxonomyRail({ items, selectedId, onSelect, kind = 'industry', allLabel }) {
  if (!items?.length) return null;
  const big = kind === 'industry';

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, big ? styles.rowBig : styles.rowSmall]}
    >
      {allLabel ? (
        <Tile
          big={big}
          label={allLabel}
          icon="apps"
          tint={colors.accentSoft}
          // The "everything" tile is the one tile with no row behind it, so it
          // has no position and cannot take an ink from `tileArt`. It gets the
          // accent's own ink, which is what `accentSoft` was mixed against.
          ink={colors.onAccent}
          selected={selectedId == null}
          onPress={() => onSelect(null)}
        />
      ) : null}

      {items.map((item, index) => {
        const art = artFor(item, index, kind);
        return (
          <Tile
            key={item.id}
            big={big}
            label={art.label}
            icon={art.icon}
            imageUrl={art.imageUrl}
            tint={art.tint}
            ink={art.ink}
            selected={item.id === selectedId}
            onPress={() => onSelect(item.id)}
          />
        );
      })}
    </ScrollView>
  );
}

function Tile({ big, label, icon, imageUrl, tint, ink = tileInk(0), selected, onPress }) {
  const size = big ? 62 : 56;

  return (
    <Pressable
      onPress={onPress}
      style={styles.tile}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={label}
      // The tile draws at 62 dp because a row of 48 dp targets reads as a row of
      // buttons — the same visual-size-vs-touch-size split `Chip` makes — but a
      // near-miss in a horizontal scroller scrolls the row instead of selecting,
      // which is the worst failure a filter can have.
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
      <View
        style={[
          styles.art,
          {
            width: size,
            height: size,
            backgroundColor: tint,
            borderRadius: big ? radius.xl : radius.pill,
            // ⚠️ The border is ALWAYS 2 dp and only its colour changes. A border
            // that appears on selection shrinks the content box by 4 dp, so the
            // artwork visibly jumps and resizes the moment you tap it — and on
            // Android it also rebuilds the view's background drawable, which is
            // what made the clipping bug below appear only *after* a selection.
            borderColor: selected ? colors.accent : 'transparent'
          }
        ]}
      >
        {imageUrl ? (
          // The image clips itself to its own radius. `overflow: 'hidden'` on the
          // parent is what broke the glyph — see the note on `styles.art`.
          <Image
            source={{ uri: sizedImage(imageUrl, { width: size, height: size }) }}
            style={[styles.artImage, { borderRadius: (big ? radius.xl : radius.pill) - 2 }]}
            resizeMode="cover"
          />
        ) : (
          // Drawn in the tint's own ink, at a size that keeps the same optical
          // weight the emoji had — the tile, its radius and its shadow are
          // unchanged, only what sits inside it.
          <VectorIcon glyph={icon} size={big ? 30 : 26} color={ink} />
        )}
      </View>

      <Text
        style={[styles.label, selected && styles.labelSelected]}
        numberOfLines={2}
        // Centred and clipped at two lines. "Electronics and Home Appliances"
        // is a real industry name; `artFor` shortens the ones it knows and this
        // is what catches the ones it does not.
      >
        {label}
      </Text>

      {/* The selected marker is a bar under the label, not a filled tile: the
          artwork is the subject of this row and inverting its background is how
          a selected tile stops looking like the thing it depicts. */}
      <View style={[styles.underline, selected && styles.underlineOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingHorizontal: spacing.lg },
  rowBig: { paddingVertical: spacing.sm },
  rowSmall: { paddingVertical: spacing.xs },

  tile: { alignItems: 'center', width: 76, gap: 6 },

  // ⚠️ **No `overflow: 'hidden'` here, deliberately — it made the artwork
  // disappear** (fixed 2026-08-10, reported against the build above).
  //
  // The symptom was precise and is worth recording, because it looks like a
  // data problem and is not: every *unselected* industry tile rendered as an
  // empty tinted square, while the *category* tiles a few rows below rendered
  // their art perfectly in both states. Everything showed on first paint and
  // only broke once something was tapped.
  //
  // The difference between the two rails is one number. A category tile is
  // `radius.pill` (999) on a 56 dp box; an industry tile is `radius.xl` (20) on
  // 62 dp. On Android a rounded view with `overflow: 'hidden'` clips its
  // children through a `ViewOutlineProvider`, and a radius of half the box or
  // more resolves to a plain **oval** outline — the fast, reliable path, which
  // is why the circles were fine. A smaller radius falls back to an arbitrary
  // **path** clip, and combined with `elevation` (this is the only tile in the
  // app carrying a shadow) that clip drops non-image children on re-render.
  //
  // So the rule: clip the `Image`, which knows its own bounds, never the box a
  // glyph lives in. Nothing here needs the parent to clip anything.
  art: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    ...shadow
  },
  artImage: { width: '100%', height: '100%' },
  label: { fontSize: 11, fontWeight: '600', color: colors.inkMuted, textAlign: 'center', lineHeight: 14 },
  labelSelected: { color: colors.ink, fontWeight: '800' },
  underline: { height: 3, width: 18, borderRadius: radius.pill, backgroundColor: 'transparent' },
  underlineOn: { backgroundColor: colors.accent }
});
