// Restock — the shop buying stock. This is the designed "Products" tab from
// `designs/Partner.png`: search, brand chips, a two-column product grid with
// − 1 + steppers, and a cart bar that appears once something is added.
//
// It is the B2B half of the hinge, and it is a different world from every other
// screen in this app:
//
//   • **Money here is a `Float`, not a Decimal string.** `TradeOrder` and
//     `Product.price` are deliberately still `Float` — seven web dashboards read
//     those columns and a server test enforces it (PLAN §1). `formatAmount`
//     handles both shapes; that is why it exists.
//   • **The seller is the product's owner.** `POST /api/orders/create` takes one
//     `sellerId`, so a basket spanning two distributors is two trade orders. The
//     cart is grouped by seller for that reason, not for tidiness.
//   • **Buying does not touch `ShopInventory`.** A delivered trade order is what
//     eventually increments the shelf; nothing here changes what customers can
//     buy today. The Stock tab is still the only place the shelf is corrected.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  RefreshControl,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions
} from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Chip,
  Sku,
  Button,
  Divider,
  KeyValue,
  EmptyState,
  QuantityStepper,
  formatAmount,
  formatCompact
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';

export default function Restock() {
  const { user } = useSession();
  const api = useApi();

  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState(null);
  const [cart, setCart] = useState({}); // productId → quantity
  const [cartOpen, setCartOpen] = useState(false);

  // ⚠️ The grid tile is sized in **pixels**, deliberately, and `flex: 1` is not
  // enough here — it was what this screen had, and the second column still ran
  // off the right of the phone.
  //
  // Why: a tile's widest child was its product name. "Premium Alloy Wheels (Set
  // of 4)" is ~220 dp on one line at `cardTitle`, so the row's min-content width
  // was ~450 dp on a 360 dp screen. `numberOfLines={2}` truncates a wrapped
  // line; it does not force a width, and Yoga sizes a row to its content before
  // it grows anything — so both tiles took their intrinsic width and the row
  // overflowed rather than the titles wrapping.
  //
  // An explicit width takes the decision away from the content entirely: the two
  // tiles plus one gap are exactly the list's width, so nothing a distributor
  // types into a product name can ever push a column off screen again.
  const { width: screenWidth } = useWindowDimensions();
  const tileWidth = Math.floor((screenWidth - spacing.lg * 2 - spacing.md) / 2);

  const catalog = useResource(useCallback(() => api.listCatalog(user?.industry?.id), [api, user]));
  const products = catalog.data?.products ?? [];

  const brands = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand).filter(Boolean))).slice(0, 8),
    [products]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (brand && p.brand !== brand) return false;
      if (!needle) return true;
      return `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(needle);
    });
  }, [products, search, brand]);

  const lineCount = Object.values(cart).reduce((n, q) => n + (q > 0 ? 1 : 0), 0);

  const setQuantity = (productId, quantity) =>
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[productId];
      else next[productId] = quantity;
      return next;
    });

  return (
    <View style={styles.flex}>
      <View style={styles.filters}>
        <TextInput
          style={styles.search}
          placeholder="Search engine oil, filters, batteries…"
          placeholderTextColor={colors.inkFaint}
          value={search}
          onChangeText={setSearch}
        />
        {brands.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {brands.map((b) => (
              <Chip key={b} label={b} selected={brand === b} onPress={() => setBrand(brand === b ? null : b)} />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.grid}
        refreshControl={<RefreshControl refreshing={catalog.refreshing} onRefresh={catalog.reload} tintColor={colors.accent} />}
        ListEmptyComponent={
          !catalog.loading ? (
            <EmptyState
              title="Nothing to order"
              message={
                catalog.error
                  ? catalog.error.message
                  : 'No products are listed for your industry yet. Your distributor adds them from their own app.'
              }
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ProductTile
            product={item}
            width={tileWidth}
            quantity={cart[item.id] ?? 0}
            onChange={(q) => setQuantity(item.id, q)}
          />
        )}
      />

      {lineCount > 0 ? (
        <Card style={styles.cartBar} onPress={() => setCartOpen(true)}>
          <Text style={styles.cartText}>
            {lineCount} item{lineCount === 1 ? '' : 's'} added
          </Text>
          <Text style={styles.cartAction}>View cart ›</Text>
        </Card>
      ) : null}

      {cartOpen ? (
        <CartSheet
          cart={cart}
          products={products}
          api={api}
          onClose={() => setCartOpen(false)}
          onPlaced={() => {
            setCart({});
            setCartOpen(false);
          }}
          onChange={setQuantity}
        />
      ) : null}
    </View>
  );
}

function ProductTile({ product, width, quantity, onChange }) {
  // `stockLevel` is the seller's stock, and `createOrder` refuses a line that
  // exceeds it — capping the stepper turns a server-side rejection at checkout
  // into something the shop can see while it is choosing.
  const max = Math.max(0, product.stockLevel ?? 0);

  return (
    <Card style={[styles.tile, { width }]}>
      {/* The catalogue has photos — `Product.image`, validated to our own asset
          host — and this tile was drawing a blank rectangle *in the page colour*
          over the top of them. 90 dp of invisible dead space per tile, on the
          screen with the most tiles.

          ⚠️ The radius goes on the `Image` itself, not on a wrapper with
          `overflow: 'hidden'`: a small-radius clipping View eats its children on
          Android. A product with no photo keeps the placeholder, but bordered,
          so it reads as "no photo" rather than as a gap in the layout. */}
      {product.image ? (
        <Image source={{ uri: product.image }} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={[styles.tileImage, styles.tileImageEmpty]} />
      )}
      {product.sku ? <Sku>{product.sku}</Sku> : null}
      <Text style={typography.cardTitle} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={typography.meta} numberOfLines={1}>
        {product.owner?.businessName ?? product.owner?.name ?? 'Distributor'}
      </Text>

      {/* Stacked, and it has to be. A tile in this two-column grid is about
          160 dp wide; the stepper alone is ~100 dp fixed (30 + 32 + 30 + pad),
          so a row of "₹36,500.00" *beside* it has a min-content width wider than
          the tile. Yoga does not shrink a fixed-width child, so the row overflowed
          and shoved the entire second column off the right of the screen.
          `formatCompact` drops the paise for the same reason — a distributor
          price list has no ₹0.50 lines and the decimals were pure width. */}
      <View style={styles.tileFoot}>
        <Text style={typography.money} numberOfLines={1}>
          {formatCompact(product.price)}
          <Text style={styles.perUnit}> / unit</Text>
        </Text>
        <QuantityStepper value={quantity} onChange={onChange} max={max} disabled={max === 0} />
      </View>
      {max === 0 ? <Text style={styles.outOfStock}>Distributor is out of stock</Text> : null}
    </Card>
  );
}

/**
 * The cart, grouped by seller — because one trade order has one seller, so a
 * basket spanning two distributors places two orders and the shop should see
 * that before it taps, not after.
 */
function CartSheet({ cart, products, api, onClose, onPlaced, onChange }) {
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const bySeller = new Map();
    for (const [productId, quantity] of Object.entries(cart)) {
      const product = products.find((p) => String(p.id) === String(productId));
      if (!product || quantity <= 0) continue;
      const sellerId = product.ownerId;
      if (!bySeller.has(sellerId)) {
        bySeller.set(sellerId, {
          sellerId,
          sellerName: product.owner?.businessName ?? product.owner?.name ?? `Seller #${sellerId}`,
          industryId: product.industryId,
          lines: []
        });
      }
      bySeller.get(sellerId).lines.push({ product, quantity });
    }
    return Array.from(bySeller.values());
  }, [cart, products]);

  // B2B money is Float on purpose, so this total is a plain sum. The B2C rule
  // about never adding money as floats does not apply here — these columns are
  // floats in the database and the dashboards already add them the same way.
  const groupTotal = (group) => group.lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
  const grandTotal = groups.reduce((sum, g) => sum + groupTotal(g), 0);

  const place = async () => {
    setBusy(true);
    const placed = [];
    try {
      // One request per seller, sequentially: a partial failure has to be
      // reportable ("2 of 3 orders placed"), and the endpoint has no batch form.
      for (const group of groups) {
        await api.createTradeOrder({
          sellerId: group.sellerId,
          industryId: group.industryId,
          items: group.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity }))
        });
        placed.push(group.sellerName);
      }
      Alert.alert(
        placed.length === 1 ? 'Order placed' : `${placed.length} orders placed`,
        'Your distributor will confirm and dispatch. Stock is added to your shelf when it arrives.'
      );
      onPlaced();
    } catch (error) {
      Alert.alert(
        placed.length ? `${placed.length} of ${groups.length} orders placed` : 'Could not place the order',
        `${error.message}${placed.length ? `\n\nPlaced with: ${placed.join(', ')}.` : ''}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>Your restock order</Text>

          <ScrollView style={styles.sheetScroll}>
            {groups.map((group) => (
              <View key={group.sellerId} style={styles.group}>
                <Text style={typography.meta}>{group.sellerName}</Text>
                {group.lines.map(({ product, quantity }) => (
                  <View key={product.id} style={styles.cartLine}>
                    <View style={styles.cartLineBody}>
                      <Text style={typography.body} numberOfLines={1}>
                        {product.name}
                      </Text>
                      <Text style={typography.meta}>{formatAmount(product.price)} / unit</Text>
                    </View>
                    <QuantityStepper
                      value={quantity}
                      onChange={(q) => onChange(product.id, q)}
                      max={Math.max(0, product.stockLevel ?? 0)}
                    />
                    <Text style={styles.lineTotal}>{formatAmount(product.price * quantity)}</Text>
                  </View>
                ))}
                <Divider />
              </View>
            ))}
          </ScrollView>

          <KeyValue label="Total" value={formatAmount(grandTotal)} strong />
          {groups.length > 1 ? (
            <Text style={typography.meta}>
              This will place {groups.length} separate orders, one with each distributor.
            </Text>
          ) : null}

          <View style={styles.sheetActions}>
            <Button label="Keep shopping" variant="ghost" onPress={onClose} disabled={busy} style={styles.sheetButton} />
            <Button label="Place order" onPress={place} loading={busy} style={styles.sheetButton} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  // Opaque with a hairline edge: the grid scrolls *under* this block, and with
  // no border the half-hidden first row read as a rendering fault rather than
  // as content behind a header.
  filters: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
    backgroundColor: colors.page,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    color: colors.ink
  },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },

  grid: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: 96 },
  column: { gap: spacing.md },
  // No `flex: 1` — the width is passed in per tile. See the note in `Restock`.
  tile: { gap: 4, padding: spacing.md },
  tileImage: {
    width: '100%',
    height: 90,
    borderRadius: radius.sm,
    backgroundColor: colors.page,
    marginBottom: spacing.xs
  },
  tileImageEmpty: { borderWidth: 1, borderColor: colors.border },
  tileFoot: { alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm },
  perUnit: { ...typography.meta, fontWeight: '400' },
  outOfStock: { ...typography.meta, color: colors.danger },

  cartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md
  },
  cartText: { fontSize: 14, fontWeight: '700', color: colors.onAccent },
  cartAction: { fontSize: 14, fontWeight: '700', color: colors.onAccent },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
    maxHeight: '80%'
  },
  sheetScroll: { flexGrow: 0 },
  group: { gap: spacing.xs, marginTop: spacing.sm },
  cartLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  cartLineBody: { flex: 1, gap: 2 },
  lineTotal: { ...typography.body, fontWeight: '700', minWidth: 72, textAlign: 'right' },
  sheetActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  sheetButton: { flex: 1 }
});
