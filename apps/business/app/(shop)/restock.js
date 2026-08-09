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
import { View, Text, TextInput, FlatList, RefreshControl, Alert, Modal, ScrollView, StyleSheet } from 'react-native';
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
  formatAmount
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

function ProductTile({ product, quantity, onChange }) {
  // `stockLevel` is the seller's stock, and `createOrder` refuses a line that
  // exceeds it — capping the stepper turns a server-side rejection at checkout
  // into something the shop can see while it is choosing.
  const max = Math.max(0, product.stockLevel ?? 0);

  return (
    <Card style={styles.tile}>
      <View style={styles.tileImage} />
      {product.sku ? <Sku>{product.sku}</Sku> : null}
      <Text style={typography.cardTitle} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={typography.meta}>{product.owner?.businessName ?? product.owner?.name ?? 'Distributor'}</Text>

      <View style={styles.tileFoot}>
        <View>
          <Text style={typography.money}>{formatAmount(product.price)}</Text>
          <Text style={typography.meta}>/ unit</Text>
        </View>
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
  filters: { padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
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
  tile: { flex: 1, gap: 4, padding: spacing.md },
  tileImage: { height: 90, borderRadius: radius.sm, backgroundColor: colors.page, marginBottom: spacing.xs },
  tileFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
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
