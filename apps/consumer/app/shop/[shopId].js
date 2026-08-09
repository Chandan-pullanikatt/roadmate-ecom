// One shop's shelf — browse-by-shop, and the only place an item is configured
// and added to a cart.
//
// Three things this screen is careful about:
//
//   • **A row is a product *and* a variant.** `GET /api/customer/shops/:id/products`
//     returns one row per `ShopInventory` row, so "Amul Butter 100g" and "500g"
//     arrive as two rows with their own prices and their own stock. There is no
//     variant picker to build: the shelf already is one.
//   • **`availableQty` is the ceiling, and it is not the shop's real count.** It
//     is `sellableQty` — the shelf minus what is reserved for orders in flight,
//     minus the shop's safety buffer for its own walk-in customers. The stepper
//     is capped at it, and the cart endpoint re-checks it anyway: adding to a
//     cart reserves nothing, so a cart that priced fine can still fail at
//     checkout (server §1.3). That is the right trade and this screen does not
//     pretend otherwise.
//   • **Required add-on groups are required.** `isRequired` on a group means the
//     line is not valid without a choice from it, so the Add button stays
//     disabled until one is made rather than sending something the customer did
//     not pick.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  ListRow,
  SearchField,
  SectionHeader,
  EmptyState,
  Banner,
  Button,
  StickyFooter,
  QuantityStepper,
  connectionMessage,
  SkeletonCard,
  formatINR,
  addMoney,
  mulMoney
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi } from '../../src/session.js';
import { POLL_MS } from '../../src/config.js';

export default function ShopScreen() {
  const { shopId, q } = useLocalSearchParams();
  const api = useApi();
  const router = useRouter();
  const navigation = useNavigation();

  // Arriving from product search carries the product name through, so the shelf
  // opens filtered to the thing the customer was actually looking at.
  const [term, setTerm] = useState(typeof q === 'string' ? q : '');
  const [selected, setSelected] = useState(null);

  const shelf = useResource(
    useCallback(() => api.getShopProducts(shopId, { limit: 50 }), [api, shopId]),
    { intervalMs: POLL_MS.catalog, deps: [shopId] }
  );

  const carts = useResource(
    useCallback(() => api.listCarts(shopId), [api, shopId]),
    { deps: [shopId] }
  );

  const shop = shelf.data?.shop;
  const cart = (carts.data?.carts ?? [])[0] ?? null;

  React.useEffect(() => {
    if (shop?.name) navigation.setOptions({ title: shop.name });
  }, [navigation, shop?.name]);

  const items = useMemo(() => {
    const all = shelf.data?.items ?? [];
    const needle = term.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (item) =>
        item.productName.toLowerCase().includes(needle) ||
        String(item.sku ?? '').toLowerCase().includes(needle) ||
        String(item.brand ?? '').toLowerCase().includes(needle)
    );
  }, [shelf.data, term]);

  // Counted off the filtered list, not the response: with a search term in the
  // box the header is describing what is on screen.
  const inStockCount = useMemo(() => items.filter((i) => i.inStock).length, [items]);

  const problem = connectionMessage(shelf.error);

  const addToCart = async (payload) =>
    // Through `withPause` like every mutating tap: a catalog poll
    // landing mid-add would otherwise re-render the shelf from pre-add data.
    carts.withPause(async () => {
      await api.addCartItem({ shopId: Number(shopId), ...payload });
    });

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={shelf.refreshing} onRefresh={() => shelf.reload()} tintColor={colors.accent} />
        }
      >
        {problem ? <Banner message={problem} action="Retry" onAction={() => shelf.reload()} /> : null}

        {shop && shop.isOpen === false ? (
          <Banner
            tone="warning"
            message="This shop is closed right now. You can look, but an order placed now would go to a different shop or nowhere at all."
          />
        ) : null}

        <SearchField value={term} onChangeText={setTerm} placeholder="Search this shop" />

        {shelf.loading && !shelf.data ? (
          <SkeletonCard count={5} thumb />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              title={term ? 'Nothing matching that here' : 'Nothing in stock right now'}
              message={
                term
                  ? 'This shop may still have it under another name — or try another shop from the home screen.'
                  : 'This shop has not listed anything it can sell today.'
              }
            />
          </Card>
        ) : (
          <View>
            {/* "12 of 14 in stock" rather than a bare count: since 2026-08-09
                the shelf includes what this shop has run out of (HANDOFF §7.6),
                and a single number over a list containing both would be a
                number nobody could interpret. */}
            <SectionHeader
              title="Available now"
              action={
                inStockCount === items.length ? `${items.length}` : `${inStockCount} of ${items.length}`
              }
            />
            <Card style={styles.list}>
              {items.map((item, index) => (
                <ListRow
                  key={item.inventoryId}
                  image={item.image ?? null}
                  subtitle={item.sku}
                  title={item.variantLabel ? `${item.productName} · ${item.variantLabel}` : item.productName}
                  meta={[
                    item.brand,
                    // Sold out is a state, not an absence: this row used to be
                    // dropped from the response entirely, which read as "they
                    // don't stock it" — a different and worse claim.
                    !item.inStock
                      ? 'Sold out'
                      : item.availableQty <= 5
                        ? `only ${item.availableQty} left`
                        : null,
                    item.isVeg === true ? 'Veg' : item.isVeg === false ? 'Non-veg' : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  right={
                    <View style={styles.priceCol}>
                      <Text style={[typography.money, !item.inStock && styles.soldOutPrice]}>
                        {formatINR(item.price)}
                      </Text>
                      {item.mrp && item.mrp !== item.price ? (
                        <Text style={styles.mrp}>{formatINR(item.mrp)}</Text>
                      ) : null}
                    </View>
                  }
                  // A sold-out row still opens: the sheet is where the price,
                  // the variant and "we will have it back" live, and a row that
                  // silently does nothing when tapped is its own small lie.
                  onPress={() => setSelected(item)}
                  style={[index > 0 ? styles.ruled : null, !item.inStock ? styles.soldOutRow : null]}
                />
              ))}
            </Card>
          </View>
        )}
      </ScrollView>

      {/* The basket for *this* shop only. A cart never spans shops, so a
          customer with three carts sees the one that belongs here. */}
      {cart && cart.itemCount > 0 ? (
        <StickyFooter>
          <Button
            label={`${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'} · ${formatINR(cart.subtotal)} — view cart`}
            onPress={() => router.push('/(tabs)/cart')}
          />
        </StickyFooter>
      ) : null}

      <ItemSheet
        item={selected}
        onClose={() => setSelected(null)}
        onAdd={async (payload) => {
          await addToCart(payload);
          setSelected(null);
        }}
      />
    </View>
  );
}

/**
 * The configure-and-add sheet: quantity, add-ons, a note.
 *
 * The running total is computed with `addMoney`/`mulMoney` — integer paise
 * under the hood — and never with `+`. It is only a preview: the price the
 * order is placed at is whatever the shelf says at that moment (`priceCart`
 * re-prices against today's shelf), and this must agree with it to the paisa or
 * it should not be shown at all.
 */
function ItemSheet({ item, onClose, onAdd }) {
  const [quantity, setQuantity] = useState(1);
  const [addOnIds, setAddOnIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    setQuantity(1);
    setAddOnIds([]);
    setError(null);
  }, [item?.inventoryId]);

  if (!item) return null;

  // Add-ons arrive flat with a `groupName`; the grouping is the customer's
  // mental model ("Size", "Extras") and `isRequired` / `maxSelect` are per group.
  const groups = [];
  for (const addOn of item.addOns ?? []) {
    const name = addOn.groupName ?? 'Options';
    let group = groups.find((g) => g.name === name);
    if (!group) {
      group = { name, isRequired: false, maxSelect: null, options: [] };
      groups.push(group);
    }
    group.options.push(addOn);
    if (addOn.isRequired) group.isRequired = true;
    if (addOn.maxSelect) group.maxSelect = Math.max(group.maxSelect ?? 0, addOn.maxSelect);
  }

  const chosen = (item.addOns ?? []).filter((a) => addOnIds.includes(a.id));
  const addOnTotal = chosen.reduce((sum, a) => addMoney(sum, a.price), '0.00');
  const lineTotal = mulMoney(addMoney(item.price, addOnTotal), quantity);

  const missingGroup = groups.find(
    (g) => g.isRequired && !g.options.some((o) => addOnIds.includes(o.id))
  );

  const toggle = (group, addOn) => {
    setAddOnIds((current) => {
      if (current.includes(addOn.id)) return current.filter((id) => id !== addOn.id);
      const inGroup = group.options.filter((o) => current.includes(o.id)).map((o) => o.id);
      const limit = group.maxSelect ?? (group.isRequired ? 1 : group.options.length);
      // At the limit, the newest choice replaces the oldest one in that group —
      // a customer hitting a cap should feel a swap, not a dead tap.
      const kept = inGroup.length >= limit ? inGroup.slice(1) : inGroup;
      const others = current.filter((id) => !group.options.some((o) => o.id === id));
      return [...others, ...kept, addOn.id];
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity,
        addOnIds
      });
    } catch (err) {
      // 409 is the shelf answering with `availableQty` — an outcome to show,
      // never a retry.
      setError(
        err.status === 409 && err.body?.availableQty === 0
          ? 'This just went out of stock at this shop.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Text style={typography.sectionTitle}>
            {item.variantLabel ? `${item.productName} · ${item.variantLabel}` : item.productName}
          </Text>
          <Text style={typography.meta}>
            {formatINR(item.price)} each
            {item.inStock ? ` · ${item.availableQty} available` : ''}
          </Text>

          {/* Sold out, said rather than implied by a dead button. The quantity
              stepper and the add action below are not rendered at all — the
              same rule the Rider app applies to a camera it cannot use. */}
          {!item.inStock ? (
            <Banner
              tone="warning"
              message="Sold out at this shop right now. This page updates every few seconds, and other shops nearby may have it — try the search tab."
            />
          ) : null}

          {groups.map((group) => (
            <View key={group.name} style={styles.group}>
              <Text style={styles.groupTitle}>
                {group.name}
                {group.isRequired ? ' · required' : ''}
                {group.maxSelect ? ` · pick up to ${group.maxSelect}` : ''}
              </Text>
              {group.options.map((option) => {
                const on = addOnIds.includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => toggle(group, option)}
                    style={[styles.option, on && styles.optionOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Text style={[typography.body, on && styles.optionOnText]}>{option.label}</Text>
                    <Text style={typography.meta}>
                      {option.price && option.price !== '0.00' ? `+ ${formatINR(option.price)}` : 'included'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          {item.inStock ? (
            <View style={styles.qtyRow}>
              <Text style={typography.body}>Quantity</Text>
              <QuantityStepper value={quantity} onChange={setQuantity} min={1} max={item.availableQty} />
            </View>
          ) : null}

          {error ? <Banner tone="danger" message={error} /> : null}
        </ScrollView>

        <StickyFooter>
          {item.inStock ? (
            <Button
              label={missingGroup ? `Choose a ${missingGroup.name.toLowerCase()}` : `Add · ${formatINR(lineTotal)}`}
              onPress={submit}
              loading={busy}
              disabled={Boolean(missingGroup)}
            />
          ) : null}
          <Button label={item.inStock ? 'Cancel' : 'Close'} variant="ghost" onPress={onClose} />
        </StickyFooter>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  list: { paddingVertical: spacing.xs },
  ruled: { borderTopWidth: 1, borderTopColor: colors.border },
  priceCol: { alignItems: 'flex-end' },
  // Dimmed, not hidden: the row is still readable and still tappable, it just
  // stops competing with the things that can be bought.
  soldOutRow: { opacity: 0.55 },
  soldOutPrice: { textDecorationLine: 'line-through' },
  mrp: { ...typography.meta, textDecorationLine: 'line-through' },

  backdrop: { flex: 1, backgroundColor: '#0B122055' },
  sheet: {
    backgroundColor: colors.page,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%'
  },
  sheetBody: { padding: spacing.lg, gap: spacing.md },
  group: { gap: spacing.sm, marginTop: spacing.sm },
  groupTitle: { ...typography.sku },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 44
  },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionOnText: { fontWeight: '700' },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md
  }
});
