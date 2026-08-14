// Browse by product — the other half of the hybrid browse (HANDOFF §3).
//
// This is **not** a search box over the home screen's shop list. It is a
// different question with a different endpoint: `GET /api/customer/products`
// groups one product across every serviceable shop and sorts the offers
// cheapest first, so "who sells Amul butter near me, and for how much" is one
// screen rather than a tour of five shops.
//
// **Tapping an offer opens the shop rather than adding to a cart**, and that is
// deliberate. This endpoint does not return a product's add-on groups — it
// cannot, because it is grouping across shops — so a one-tap add here would
// silently skip a *required* add-on group and put a line in the cart the
// customer never chose. The shop screen has the full shelf row and is where an
// item is configured.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  typography,
  Card,
  ListRow,
  SearchField,
  EmptyState,
  Banner,
  Button,
  connectionMessage,
  SkeletonCard,
  formatINR
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi } from '../../src/session.js';
import { usePlace } from '../../src/place.js';
import { POLL_MS } from '../../src/config.js';
import { isOrderable } from '../../src/order.js';

export default function Search() {
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { point, industryId, industry, fulfilmentType } = usePlace();

  // An opening query, when something sent us here — a banner pointing at a
  // product, or a tap on a collection (PHASE B). Those screens list `Product`
  // rows, and which shop near this customer actually has one is precisely what
  // this screen answers, so they hand the name over rather than pretending to
  // know the answer themselves.
  //
  // `categoryId` arrives the same way, from the home screen's category rail (the
  // storefront pass, 2026-08-10). It is a **navigation** parameter, not screen
  // state: the rail jumps here filtered, and the filter belongs to this visit
  // rather than to the customer — which is why it is read from the route and
  // dropped when they leave, and why a category never narrows a later search
  // somebody typed by hand.
  const { q: initialQuery, categoryId: initialCategoryId } = useLocalSearchParams();
  const opening = typeof initialQuery === 'string' ? initialQuery : '';
  const categoryId = Number.parseInt(initialCategoryId, 10) || null;

  const [term, setTerm] = useState(opening);
  // Submitted, not live: this endpoint ranks across every serviceable shop, and
  // firing it on every keystroke would be a query per character for a list
  // nobody is reading yet.
  const [query, setQuery] = useState(opening);

  const orderable = isOrderable(fulfilmentType);

  // The name of the category being filtered on. Fetched rather than passed
  // through the route: a label in a URL is a second copy of the taxonomy that
  // goes stale the moment somebody renames a category on the Master screen.
  const categories = useResource(
    useCallback(
      () => (categoryId ? api.listCategories({ industryId }) : Promise.resolve(null)),
      [api, industryId, categoryId]
    ),
    { enabled: Boolean(categoryId), deps: [industryId, categoryId], cacheKey: 'search-categories' }
  );
  const categoryName = (categories.data?.categories ?? []).find((c) => c.id === categoryId)?.name ?? null;

  const products = useResource(
    useCallback(
      () =>
        point
          ? api.searchProducts({ lat: point.lat, lng: point.lng, industryId, q: query, categoryId })
          : Promise.resolve(null),
      [api, point, industryId, query, categoryId]
    ),
    {
      enabled: Boolean(point) && orderable,
      // Slower than the shop screen on purpose: this query fans out across every
      // serviceable shop, and this is where somebody scrolls rather than taps a
      // stepper. The shop screen is where "live" has to mean seconds.
      intervalMs: POLL_MS.search,
      deps: [point?.lat, point?.lng, industryId, query, categoryId],
      // Keyed by the typed query too, so backing out of a product and searching
      // the same word again is instant rather than another fan-out across every
      // serviceable shop — the most expensive question this app asks.
      cacheKey: 'product-search'
    }
  );

  const list = products.data?.products ?? [];
  const problem = connectionMessage(products.error);

  return (
    <ScrollView
      contentContainerStyle={[styles.wrap, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={products.refreshing}
          onRefresh={() => products.reload()}
          tintColor={colors.accent}
        />
      }
    >
      <Text style={typography.screenTitle}>
        {categoryName ?? `Search ${industry?.name?.toLowerCase() ?? ''}`}
      </Text>

      <SearchField
        value={term}
        onChangeText={(next) => {
          setTerm(next);
          if (!next) setQuery('');
        }}
        onSubmit={() => setQuery(term.trim())}
        placeholder="What are you looking for?"
      />

      {/* The filter, said out loud with a way out of it. A narrowed list with no
          visible reason is how somebody concludes the shop has nothing. */}
      {categoryId ? (
        <Pressable
          onPress={() => router.replace('/(tabs)/search')}
          style={styles.filterChip}
          accessibilityRole="button"
          accessibilityLabel={`Filtered by ${categoryName ?? 'category'}. Clear the filter.`}
        >
          <Text style={styles.filterText}>{categoryName ?? 'Category'}</Text>
          <Text style={styles.filterClear}>✕</Text>
        </Pressable>
      ) : null}

      {problem ? <Banner message={problem} action="Retry" onAction={() => products.reload()} /> : null}

      {!point ? (
        <Card>
          <EmptyState
            title="Set a delivery address first"
            message="Prices and availability are per shop, so we need to know which shops can reach you."
            action={<Button label="Choose an address" onPress={() => router.push('/addresses')} />}
          />
        </Card>
      ) : !orderable ? (
        <Card>
          <EmptyState title="Not open yet" message="This category is on the way." />
        </Card>
      ) : products.loading && !products.data ? (
        <SkeletonCard count={4} thumb />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title={query ? `Nothing matching “${query}”` : 'Nothing to show yet'}
            message={
              query
                ? 'No shop near you lists this at all. Try a shorter word, or a different category.'
                : 'Search for a product to see who near you has it, and for how much.'
            }
          />
        </Card>
      ) : (
        <Card style={styles.list}>
          {list.map((product, index) => {
            // The offers are already sorted cheapest-first by the server, with
            // distance breaking a price tie. The app must not re-sort them: it
            // would be a second opinion on the same question.
            const best = product.offers[0];
            return (
              <ListRow
                key={product.id}
                image={product.image ?? null}
                subtitle={product.sku}
                title={product.name}
                meta={[
                  // `product.inStock` is false only when *every* shop with it is
                  // out — the server sorts a buyable offer to the front, so
                  // `best` is sold out only if they all are (HANDOFF §7.6).
                  product.inStock ? null : 'Sold out nearby',
                  product.offers.length > 1
                    ? `${best.shop.name} · ${best.shop.distanceKm} km · +${product.offers.length - 1} more ${
                        product.offers.length === 2 ? 'shop' : 'shops'
                      }`
                    : `${best.shop.name} · ${best.shop.distanceKm} km`
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <View style={styles.price}>
                    <Text style={[typography.money, !product.inStock && styles.soldOutPrice]}>
                      {formatINR(best.price)}
                    </Text>
                    {best.variantLabel ? <Text style={typography.meta}>{best.variantLabel}</Text> : null}
                  </View>
                }
                onPress={() => router.push(`/shop/${best.shop.id}?q=${encodeURIComponent(product.name)}`)}
                style={[index > 0 ? styles.ruled : null, !product.inStock ? styles.soldOutRow : null]}
              />
            );
          })}
        </Card>
      )}

      <Text style={styles.footnote}>In stock first, then cheapest. Distance breaks a tie.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  list: { paddingVertical: spacing.xs },
  ruled: { borderTopWidth: 1, borderTopColor: colors.border },
  price: { alignItems: 'flex-end' },
  soldOutRow: { opacity: 0.55 },
  soldOutPrice: { textDecorationLine: 'line-through' },
  footnote: { ...typography.meta, textAlign: 'center' },

  filterChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: -spacing.sm
  },
  filterText: { fontSize: 12, fontWeight: '700', color: colors.ink },
  filterClear: { fontSize: 12, fontWeight: '700', color: colors.inkMuted }
});
