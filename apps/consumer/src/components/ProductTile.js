// One product in a curated collection — the "₹9 Deals" grid in the design.
//
// ⚠️ **A collection is curation, not an offer to sell** (server:
// `listCustomerCollections`). It lists `Product` rows; whether a shop near this
// customer has one in stock is `ShopInventory`'s question, answered by the browse
// screens. So this tile shows a price and **no Add button** — tapping goes to
// the product's shops, never straight into a cart. An Add here would be the app
// promising something the platform has not checked, on the one screen where the
// answer genuinely varies by postcode.
//
// The struck-through MRP is the design's ₹310.00 → ₹294.00. `Product.mrp` has
// existed since Phase 0 and `shelfItem` has always returned it; no seeded
// product had ever set one, so every price on every screen rendered bare until
// `npm run demo:storefront`.
import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, shadow, formatAmount, VectorIcon, tileInk } from '@roadmate/ui';

export default function ProductTile({ product, icon = 'bag-handle', tint = '#F1F3F6', ink = tileInk(0), onPress }) {
  const price = product.price != null ? Number(product.price) : null;
  const mrp = product.mrp != null ? Number(product.mrp) : null;
  // Only when it is actually higher. An MRP equal to the price is not a discount
  // and a struck-through identical number reads as a rendering fault.
  const off = mrp && price && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={product.name}
    >
      <View style={[styles.art, { backgroundColor: tint }]}>
        {product.image ? (
          <Image source={{ uri: product.image }} style={styles.image} resizeMode="cover" />
        ) : (
          <VectorIcon glyph={icon} size={36} color={ink} />
        )}
        {off ? (
          <View style={styles.off}>
            <Text style={styles.offText}>{off}% OFF</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      {product.brand ? (
        <Text style={styles.brand} numberOfLines={1}>
          {product.brand}
        </Text>
      ) : null}

      {price != null ? (
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatAmount(price)}</Text>
          {off ? <Text style={styles.mrp}>{formatAmount(mrp)}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 132,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: 3,
    ...shadow
  },
  pressed: { opacity: 0.9 },
  // No `overflow: 'hidden'` — same Android clipping bug as `TaxonomyRail.js`,
  // and this box shows a glyph for every product without a photograph. The
  // image rounds itself; the discount badge is inset and never needed clipping.
  art: {
    height: 96,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs
  },
  image: { width: '100%', height: '100%', borderRadius: radius.md },
  off: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: colors.success,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4
  },
  offText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },

  name: { fontSize: 12, fontWeight: '700', color: colors.ink, lineHeight: 16 },
  brand: { fontSize: 10, color: colors.inkFaint },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: 2 },
  price: { fontSize: 14, fontWeight: '800', color: colors.ink },
  mrp: { fontSize: 11, color: colors.inkFaint, textDecorationLine: 'line-through' }
});
