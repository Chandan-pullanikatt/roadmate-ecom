// One product in a curated collection — the "₹9 Deals" grid in the design.
//
// A collection lists `Product` rows, and a `Product` is not something anybody
// can sell you: `POST /cart/items` needs a shop, a variant and an add-on set.
// For a long time this tile drew the honest conclusion and refused to add
// anything — but refusing did not remove the decision, it moved it onto the
// customer, who had to go home → search → shop → add to buy a ₹40 thing this
// tile had already shown them with a price on it. On a small screen that is
// three taps and two screens of reading, and the middle screen exists to answer
// a question they never asked.
//
// So since 2026-08-14 the server resolves the nearest buyable offer and hands
// it over (`listCustomerCollections`), and this tile has exactly three states:
//
//   • **offer.canQuickAdd** — one variant, no required add-on group, in stock.
//     Nothing is left to choose, so there is an Add button and one tap does it.
//   • **an offer that needs a decision** (a size, a required add-on) or one that
//     is sold out nearby — no button. Tapping opens the shop shelf, which is the
//     only screen carrying the full row.
//   • **no offer at all** (no address yet, so nothing was resolved) — as before:
//     a tap goes off to find out who sells it.
//
// ⚠️ The price rendered is the **offer's** price, not `Product.price`, whenever
// one resolved. A tile that carries an Add button has to show the number that
// will actually be charged; the catalogue price is a different number and
// showing it next to a button is a quote nobody honoured.
//
// The struck-through MRP is the design's ₹310.00 → ₹294.00. `Product.mrp` has
// existed since Phase 0 and `shelfItem` has always returned it; no seeded
// product had ever set one, so every price on every screen rendered bare until
// `npm run demo:storefront`.
import React from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, radius, shadow, formatAmount, VectorIcon, tileInk, sizedImage } from '@roadmate/ui';

export default function ProductTile({
  product,
  icon = 'bag-handle',
  tint = '#F1F3F6',
  ink = tileInk(0),
  offer = null,
  onPress,
  onAdd
}) {
  // 'idle' → 'busy' → 'done'. `done` is a receipt, not a quantity: the stepper
  // lives in the cart and on the shop shelf, and a second counter here would be
  // a third place that has an opinion about how many of these you are buying.
  const [state, setState] = React.useState('idle');
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  // A resolved offer supersedes the catalogue row on both numbers, together —
  // taking the price from the shop and the MRP from the product would invent a
  // discount neither of them is offering.
  const price = offer?.price != null ? Number(offer.price) : product.price != null ? Number(product.price) : null;
  const mrp = offer?.mrp != null ? Number(offer.mrp) : offer ? null : product.mrp != null ? Number(product.mrp) : null;

  // Only when it is actually higher. An MRP equal to the price is not a discount
  // and a struck-through identical number reads as a rendering fault.
  const off = mrp && price && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : null;

  const soldOut = offer ? !offer.inStock : false;
  const canAdd = Boolean(onAdd && offer?.canQuickAdd);

  const add = async () => {
    if (state !== 'idle') return;
    setState('busy');
    try {
      await onAdd(offer);
      if (mounted.current) setState('done');
    } catch {
      // The parent owns the message — a 409 from the shelf is the shop
      // answering, and it deserves more room than this tile has. All this does
      // is give the button back.
      if (mounted.current) setState('idle');
    }
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed, soldOut && styles.soldOut]}
      accessibilityRole="button"
      accessibilityLabel={product.name}
    >
      <View style={[styles.art, { backgroundColor: tint }]}>
        {product.image ? (
          <Image
            source={{ uri: sizedImage(product.image, { width: 132, height: 96 }) }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <VectorIcon glyph={icon} size={36} color={ink} />
        )}
        {off ? (
          <View style={styles.off}>
            <Text style={styles.offText}>{off}% OFF</Text>
          </View>
        ) : null}

        {/* Inside the art block, which has no `overflow: 'hidden'` (see below),
            so nothing about this is clipped on Android. */}
        {canAdd ? (
          <Pressable
            onPress={add}
            disabled={state !== 'idle'}
            hitSlop={6}
            style={({ pressed }) => [styles.add, state === 'done' && styles.added, pressed && styles.addPressed]}
            accessibilityRole="button"
            accessibilityLabel={
              state === 'done' ? `${product.name} added to your basket` : `Add ${product.name} to your basket`
            }
          >
            {state === 'busy' ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={[styles.addText, state === 'done' && styles.addedText]}>
                {state === 'done' ? 'ADDED' : 'ADD'}
              </Text>
            )}
          </Pressable>
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
          <Text style={[styles.price, soldOut && styles.strike]}>{formatAmount(price)}</Text>
          {off ? <Text style={styles.mrp}>{formatAmount(mrp)}</Text> : null}
        </View>
      ) : null}

      {/* Which shop, said out loud. Adding opens a basket *at that shop* — carts
          are per shop here — so the one thing the customer must not discover at
          checkout is whose shop they have been shopping in. */}
      {offer ? (
        <Text style={styles.shop} numberOfLines={1}>
          {soldOut ? 'Sold out nearby' : `${offer.shopName} · ${offer.distanceKm} km`}
        </Text>
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
  soldOut: { opacity: 0.6 },
  // No `overflow: 'hidden'` — same Android clipping bug as `TaxonomyRail.js`,
  // and this box shows a glyph for every product without a photograph. The
  // image rounds itself; the discount badge and the Add button are inset and
  // never needed clipping.
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

  add: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    minWidth: 54,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.card
  },
  addPressed: { opacity: 0.75 },
  added: { backgroundColor: colors.accent, borderColor: colors.accent },
  addText: { fontSize: 11, fontWeight: '800', color: colors.accent, letterSpacing: 0.3 },
  addedText: { color: '#FFFFFF' },

  name: { fontSize: 12, fontWeight: '700', color: colors.ink, lineHeight: 16 },
  brand: { fontSize: 10, color: colors.inkFaint },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: 2 },
  price: { fontSize: 14, fontWeight: '800', color: colors.ink },
  strike: { textDecorationLine: 'line-through' },
  mrp: { fontSize: 11, color: colors.inkFaint, textDecorationLine: 'line-through' },
  shop: { fontSize: 10, color: colors.inkFaint }
});
