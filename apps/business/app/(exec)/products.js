// The catalogue this executive sells from — the designed Products tab
// (`designs/Partner.png`: search, brand chips, two-column grid), read from the
// selling side instead of the buying side.
//
// This is the same `GET /api/products` the shop's Restock screen calls, and the
// difference is the absence of a query: `productController.getProducts` defaults
// a MANUFACTURER or DISTRIBUTOR to **its own** products when neither `ownerId`
// nor `industryId` is given. That default is exactly right here and exactly
// wrong for the shop, which is why Restock passes `industryId` explicitly.
//
// It is the other end of the shop's Restock screen in a literal sense: a
// product's `stockLevel` here is the ceiling the shop's stepper enforces, and
// its `price` is what the shop pays. Editing either changes what a shop sees.
//
// Money is B2B `Float` — `formatAmount`, and prices are typed as plain numbers
// because that is what the column is. The B2C Decimal-string discipline does
// not apply and importing it here would be wrong.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Image, FlatList, RefreshControl, Alert, Modal, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Chip,
  Sku,
  Button,
  Icon,
  Divider,
  EmptyState,
  formatAmount,
  sizedImage
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';

/** The odd-row spacer's id. A string, so it can never collide with a real one. */
const FILLER = '__filler__';

export default function ExecProducts() {
  const { user } = useSession();
  const api = useApi();

  const products = useResource(useCallback(() => api.listProducts(), [api]), {
    cacheKey: 'exec-products',
    intervalMs: POLL_MS.stock
  });
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState(null);
  const [editing, setEditing] = useState(null); // a product, or {} for a new one

  const all = products.data?.products ?? [];

  const brands = useMemo(
    () => Array.from(new Set(all.map((p) => p.brand).filter(Boolean))).slice(0, 8),
    [all]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((p) => {
      if (brand && p.brand !== brand) return false;
      if (!needle) return true;
      return `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(needle);
    });
  }, [all, search, brand]);

  /**
   * An odd number of products gets one invisible filler.
   *
   * `numColumns={2}` lays the last row out as a normal flex row, and a tile is
   * `flex: 1` — so a row holding one tile gives it *everything*, and the last
   * product in an odd catalogue draws at double the width of every other. It
   * reads as a feature ("this one is highlighted") rather than as a gap, which
   * is why it survived: three products is the demo data, and three is odd.
   *
   * A spacer rather than `maxWidth: '48%'` on the tile: the column gap is a real
   * 12 dp, so any percentage is an approximation that disagrees with the rows
   * above it at some screen width.
   */
  const rows = useMemo(
    () => (visible.length % 2 === 1 ? [...visible, { id: FILLER, filler: true }] : visible),
    [visible]
  );

  const remove = (product) =>
    Alert.alert(
      `Remove ${product.name}?`,
      'Buyers will no longer be able to order it. Orders already placed are unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            products.withPause(async () => {
              try {
                await api.deleteProduct(product.id);
              } catch (error) {
                Alert.alert('Could not remove', error.message);
              }
            })
        }
      ]
    );

  return (
    <View style={styles.flex}>
      <View style={styles.filters}>
        <TextInput
          style={styles.search}
          placeholder="Search your catalogue…"
          placeholderTextColor={colors.inkFaint}
          value={search}
          onChangeText={setSearch}
        />
        {brands.length ? (
          <View style={styles.chips}>
            {brands.map((b) => (
              <Chip key={b} label={b} selected={brand === b} onPress={() => setBrand(brand === b ? null : b)} />
            ))}
          </View>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.grid}
        refreshControl={
          <RefreshControl refreshing={products.refreshing} onRefresh={products.reload} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          !products.loading ? (
            <EmptyState
              title={search || brand ? 'Nothing matches' : 'Your catalogue is empty'}
              message={
                products.error
                  ? products.error.message
                  : 'Add a product and your buyers can order it from their own app straight away.'
              }
            />
          ) : null
        }
        renderItem={({ item }) =>
          item.filler ? (
            // Holds the second column open. Not a `Card` — it must occupy space
            // without drawing anything.
            <View style={styles.tile} />
          ) : (
            <ProductTile product={item} onEdit={() => setEditing(item)} onRemove={() => remove(item)} />
          )
        }
      />

      <View style={styles.addBar}>
        <Button label="Add a product" onPress={() => setEditing({})} />
      </View>

      {editing ? (
        <ProductEditor
          product={editing}
          api={api}
          industryId={user?.industry?.id}
          resource={products}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function ProductTile({ product, onEdit, onRemove }) {
  const out = (product.stockLevel ?? 0) === 0;
  return (
    <Card style={styles.tile}>
      {/* The catalogue has photos — `Product.image` — and this tile was drawing a
          blank rectangle *in the page colour* over the top of them, exactly as
          the shop's Restock grid did before 2026-08-12. Same fix, and the same
          warning: the radius goes on the `Image` itself, never on a wrapper with
          `overflow: 'hidden'`, because a small-radius clipping View eats its
          children on Android. No photo keeps the placeholder, but bordered, so it
          reads as "no photo" rather than as a hole in the layout. */}
      {product.image ? (
        <Image
          source={{ uri: sizedImage(product.image, { height: 90, width: 180 }) }}
          style={styles.tileImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.tileImage, styles.tileImageEmpty]} />
      )}
      <Sku>{product.sku}</Sku>
      <Text style={typography.cardTitle} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={typography.money}>{formatAmount(product.price)}</Text>
      {/* `stockLevel` is what caps a buyer's stepper and what `createOrder`
          refuses to exceed — so it is the number on the tile, not a detail. */}
      <Text style={[typography.meta, out && styles.out]} numberOfLines={1}>
        {out ? 'Out of stock' : `${product.stockLevel} in stock`}
      </Text>

      {/* ── Why these two are not the same shape ──────────────────────────────
          They used to be two `flex: 1` buttons captioned "Edit" and "Remove",
          and in a 158 dp tile that leaves each about 47 dp of text width. That
          is narrower than the word "Remove", so it wrapped to "Remo / ve".

          Making them fit was never only a sizing problem. Two equal buttons said
          editing and deleting are equally likely, and the red one said deleting
          was the *louder* of the two — on a catalogue where editing a price is
          weekly and removing a product is rare and irreversible for the buyers
          who can no longer order it. So: Edit takes the width and carries the
          label; Remove is a bin, at a 40 dp touch target, with the confirmation
          it always had. `accessibilityLabel` names the product, because "Remove"
          alone in a grid of three is ambiguous to a screen reader. */}
      <View style={styles.tileActions}>
        <Button label="Edit" variant="secondary" style={styles.tileEdit} onPress={onEdit} />
        <Button
          variant="danger"
          style={styles.tileRemove}
          icon={<Icon name="delete" size={18} color={colors.danger} />}
          accessibilityLabel={`Remove ${product.name}`}
          onPress={onRemove}
        />
      </View>
    </Card>
  );
}

/** Create or update. The same four fields either way. */
function ProductEditor({ product, api, industryId, resource, onClose }) {
  const isNew = !product.id;
  const [name, setName] = useState(product.name ?? '');
  const [sku, setSku] = useState(product.sku ?? '');
  const [price, setPrice] = useState(product.price != null ? String(product.price) : '');
  const [stockLevel, setStockLevel] = useState(product.stockLevel != null ? String(product.stockLevel) : '');
  const [busy, setBusy] = useState(false);

  const priceValue = Number(price);
  const stockValue = Number(stockLevel);
  const valid =
    name.trim() && Number.isFinite(priceValue) && priceValue > 0 && Number.isInteger(stockValue) && stockValue >= 0;

  const save = () =>
    resource.withPause(async () => {
      setBusy(true);
      try {
        const body = { name: name.trim(), sku: sku.trim() || undefined, price: priceValue, stockLevel: stockValue };
        if (isNew) await api.createProduct({ ...body, industryId });
        else await api.updateProduct(product.id, body);
        onClose();
      } catch (error) {
        Alert.alert('Could not save', error.message);
      } finally {
        setBusy(false);
      }
    });

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>{isNew ? 'Add a product' : product.name}</Text>
          <Divider />

          <Field label="Name" value={name} onChangeText={setName} placeholder="TVS Chain Lube 2.0" />
          <Field label="SKU" value={sku} onChangeText={setSku} placeholder="RM-44021" autoCapitalize="characters" />
          <Field
            label="Price per unit (₹)"
            value={price}
            onChangeText={setPrice}
            placeholder="294"
            keyboardType="decimal-pad"
          />
          <Field
            label="Units in stock"
            value={stockLevel}
            onChangeText={setStockLevel}
            placeholder="120"
            keyboardType="number-pad"
          />

          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" style={styles.sheetButton} onPress={onClose} disabled={busy} />
            <Button
              label={isNew ? 'Add product' : 'Save'}
              style={styles.sheetButton}
              onPress={save}
              loading={busy}
              disabled={!valid}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={typography.meta}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.inkFaint} {...props} />
    </View>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  grid: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: 96 },
  column: { gap: spacing.md },
  tile: { flex: 1, gap: 4, padding: spacing.md },
  tileImage: {
    width: '100%',
    height: 90,
    borderRadius: radius.sm,
    backgroundColor: colors.page,
    marginBottom: spacing.xs
  },
  tileImageEmpty: { borderWidth: 1, borderColor: colors.border },
  out: { color: colors.danger },
  tileActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  // Edit takes whatever is left; Remove is a fixed 40 dp square. Square and not
  // `flex` on purpose — a bin that stretched with the tile would read as the
  // primary action again, which is the thing being fixed.
  tileEdit: { flex: 1, minHeight: 40, paddingHorizontal: spacing.sm },
  tileRemove: { width: 40, minHeight: 40, paddingHorizontal: 0 },

  addBar: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
    maxHeight: '90%'
  },
  field: { gap: spacing.xs },
  input: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    color: colors.ink
  },
  sheetActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  sheetButton: { flex: 1 }
});
