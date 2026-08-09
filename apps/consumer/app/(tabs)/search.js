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
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
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

  const [term, setTerm] = useState('');
  // Submitted, not live: this endpoint ranks across every serviceable shop, and
  // firing it on every keystroke would be a query per character for a list
  // nobody is reading yet.
  const [query, setQuery] = useState('');

  const orderable = isOrderable(fulfilmentType);

  const products = useResource(
    useCallback(
      () =>
        point
          ? api.searchProducts({ lat: point.lat, lng: point.lng, industryId, q: query })
          : Promise.resolve(null),
      [api, point, industryId, query]
    ),
    {
      enabled: Boolean(point) && orderable,
      // Slower than the shop screen on purpose: this query fans out across every
      // serviceable shop, and this is where somebody scrolls rather than taps a
      // stepper. The shop screen is where "live" has to mean seconds.
      intervalMs: POLL_MS.search,
      deps: [point?.lat, point?.lng, industryId, query]
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
      <Text style={typography.screenTitle}>Search {industry?.name?.toLowerCase() ?? ''}</Text>

      <SearchField
        value={term}
        onChangeText={(next) => {
          setTerm(next);
          if (!next) setQuery('');
        }}
        onSubmit={() => setQuery(term.trim())}
        placeholder="What are you looking for?"
      />

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
  footnote: { ...typography.meta, textAlign: 'center' }
});
