// Home — where you are, what you are shopping for, and who can serve you.
//
// The whole screen is one question asked of the server: `GET
// /api/customer/serviceable?lat&lng&industryId`. Everything above the list only
// decides the three parameters.
//
// **Serviceability is answered, not guessed, and it has two distinct nos.**
// `NO_SHOP` means nobody is in range; `NO_RIDER` means shops are in range but
// nobody can collect from them — which since 2026-08-08 also covers a
// self-delivering shop whose own delivery boys are all off shift (HANDOFF §3).
// They are different sentences to a customer and this screen says both, because
// "not available in your area" for what is really "come back in an hour" is how
// somebody deletes the app.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, Image, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  Chip,
  ListRow,
  StatusPill,
  SectionHeader,
  EmptyState,
  Banner,
  Button,
  connectionMessage,
  SkeletonCard,
  GreetingHeader
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi, useSession } from '../../src/session.js';
import { usePlace } from '../../src/place.js';
import { POLL_MS, PREPAID_ENABLED } from '../../src/config.js';
import { formatAddress, isVoucherIndustry, isOrderable } from '../../src/order.js';

export default function Home() {
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer } = useSession();
  const {
    industries,
    industry,
    industryId,
    setIndustryId,
    fulfilmentType,
    address,
    point,
    pointSource,
    locationState,
    locateDevice
  } = usePlace();

  const orderable = isOrderable(fulfilmentType);

  const serviceable = useResource(
    useCallback(
      () => (point ? api.getServiceable(point.lat, point.lng, industryId) : Promise.resolve(null)),
      [api, point, industryId]
    ),
    { intervalMs: POLL_MS.catalog, enabled: Boolean(point) && orderable, deps: [point?.lat, point?.lng, industryId] }
  );

  // Merchandising (PHASE B). Both are independent of serviceability on purpose:
  // they are the platform's editorial, not an offer to sell, so they render
  // while the shop list is still loading and they do not depend on a point.
  //
  // Neither failure is surfaced. A home screen that cannot fetch its banners is
  // a home screen without banners — showing an error strip about promotional
  // artwork above a working shop list would be the wrong thing to shout about.
  const banners = useResource(
    useCallback(() => api.listBanners({ industryId }), [api, industryId]),
    { deps: [industryId] }
  );
  const collections = useResource(
    useCallback(() => api.listCollections({ industryId }), [api, industryId]),
    { deps: [industryId] }
  );

  const bannerList = banners.data?.banners ?? [];
  const collectionList = collections.data?.collections ?? [];

  /**
   * Where a banner goes when tapped.
   *
   * A PRODUCT target opens the search screen with the product's **name**, not
   * its id: browse-by-product is the screen that knows which serviceable shop
   * actually has one, and a banner cannot know that — the answer depends on
   * where the customer is standing.
   *
   * NONE goes nowhere, and neither does COUPON: the offer is applied at
   * checkout, so sending somebody to a cart they have not filled yet is a dead
   * end. The code is printed on the strip instead.
   */
  const openBanner = (banner) => {
    const target = banner.target ?? {};
    if (target.type === 'SHOP') router.push(`/shop/${target.id}`);
    else if (target.type === 'PRODUCT' && target.label) {
      router.push(`/(tabs)/search?q=${encodeURIComponent(target.label)}`);
    }
  };

  const shops = serviceable.data?.shops ?? [];
  const problem = connectionMessage(serviceable.error);

  return (
    <ScrollView
      contentContainerStyle={[styles.wrap, { paddingTop: insets.top + spacing.md }]}
      refreshControl={
        <RefreshControl
          refreshing={serviceable.refreshing}
          onRefresh={() => serviceable.reload()}
          tintColor={colors.accent}
        />
      }
    >
      <GreetingHeader name={customer?.name || `+91 ${customer?.phone ?? ''}`.trim()} />

      {/* Where this order is going. It is a button, not a label: it is the one
          thing on the screen that changes every answer below it. */}
      <Card onPress={() => router.push('/addresses')} style={styles.placeCard}>
        <Text style={typography.meta}>Deliver to</Text>
        <Text style={typography.cardTitle} numberOfLines={1}>
          {address
            ? `${address.label} · ${formatAddress(address)}`
            : pointSource === 'device'
              ? 'Your current location'
              : 'Choose an address'}
        </Text>
        <Text style={styles.placeHint}>
          {pointSource === 'device'
            ? 'Using your phone’s location. Save an address to be sure your order goes to the right door.'
            : address
              ? 'Change'
              : 'We need a delivery point before we can show you anything.'}
        </Text>
      </Card>

      {/* Seven industries, one row. The switcher filters — it never navigates. */}
      {industries.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {industries.map((i) => (
            <Chip
              key={i.id}
              label={i.name}
              selected={i.id === industryId}
              onPress={() => setIndustryId(i.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* The promotional strip (PHASE B). Server-side the window is already
          applied, so anything here is live by definition — this screen knows
          nothing about dates and a festival banner disappears on its own. */}
      {bannerList.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bannerRow}
        >
          {bannerList.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => openBanner(b)}
              style={styles.bannerCard}
              accessibilityRole="button"
              accessibilityLabel={b.title}
            >
              <Image source={{ uri: b.imageUrl }} style={styles.bannerImage} resizeMode="cover" />
              <View style={styles.bannerText}>
                <Text style={styles.bannerTitle} numberOfLines={1}>{b.title}</Text>
                {b.subtitle ? (
                  <Text style={styles.bannerSubtitle} numberOfLines={1}>{b.subtitle}</Text>
                ) : null}
                {b.target?.type === 'COUPON' && b.target.code ? (
                  <Text style={styles.bannerCode}>Use {b.target.code}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {problem ? <Banner message={problem} action="Retry" onAction={() => serviceable.reload()} /> : null}

      {/* NO_DELIVERY is PREPAID-only on the server, so with no payment gateway
          configured a membership cannot be bought at all. Saying that here is
          better than a 422 at the last tap of a checkout. */}
      {isVoucherIndustry(fulfilmentType) && !PREPAID_ENABLED ? (
        <Banner
          tone="warning"
          message="Memberships are paid online, and online payment is not switched on yet. You can browse, but not buy."
        />
      ) : null}

      {!orderable ? (
        <Card>
          <EmptyState
            title={`${industry?.name ?? 'This'} is not open yet`}
            message="This category is on the way. Everything else on RoadMate works today."
          />
        </Card>
      ) : !point ? (
        <Card>
          <EmptyState
            title="Where are we delivering?"
            message={
              locationState === 'denied'
                ? 'Location is switched off for RoadMate, which is fine — add a delivery address instead.'
                : 'Use your current location, or save an address. Everything you see depends on where the order is going.'
            }
            action={
              <View style={styles.emptyActions}>
                {locationState !== 'denied' ? (
                  <Button label="Use my location" onPress={locateDevice} />
                ) : null}
                <Button label="Add an address" variant="secondary" onPress={() => router.push('/addresses')} />
              </View>
            }
          />
        </Card>
      ) : serviceable.loading && !serviceable.data ? (
        <SkeletonCard count={3} thumb />
      ) : serviceable.data?.serviceable === false ? (
        <Card>
          <EmptyState
            title={
              serviceable.data.reason === 'NO_RIDER'
                ? 'Nobody can deliver right now'
                : 'Not here yet'
            }
            message={
              serviceable.data.reason === 'NO_RIDER'
                ? 'There are shops near you, but no delivery partner is on shift. This usually changes within the hour — try again shortly.'
                : `No ${industry?.name?.toLowerCase() ?? ''} shop delivers to this address yet. Try another category, or another address.`
            }
            action={<Button label="Check again" variant="secondary" onPress={() => serviceable.reload()} />}
          />
        </Card>
      ) : (
        <View>
          <SectionHeader
            title={isVoucherIndustry(fulfilmentType) ? 'Memberships near you' : 'Shops near you'}
            action={shops.length ? `${shops.length}` : undefined}
          />
          <Card style={styles.list}>
            {shops.map((shop, index) => (
              <ListRow
                key={shop.id}
                image={shop.logoUrl ?? null}
                title={shop.name}
                meta={[
                  shop.distanceKm != null ? `${shop.distanceKm} km away` : null,
                  shop.openTime && shop.closeTime ? `${shop.openTime}–${shop.closeTime}` : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={shop.rating ? <StatusPill tone="accent" label={`★ ${shop.rating}`} /> : null}
                onPress={() => router.push(`/shop/${shop.id}`)}
                style={index > 0 ? styles.ruled : undefined}
              />
            ))}
          </Card>
        </View>
      )}

      {/* Curated lists (PHASE B) — "Items under ₹99", "Bestsellers".
          ⚠️ These are the platform's *curation*, not an offer to sell: a
          collection lists products, and which shop near this customer has one in
          stock is a different question that the browse screens answer. So a tap
          goes to that product's shops and never straight into a cart. */}
      {collectionList.map((collection) => (
        <View key={collection.id}>
          <SectionHeader title={collection.title} />
          {collection.subtitle ? (
            <Text style={styles.collectionSubtitle}>{collection.subtitle}</Text>
          ) : null}
          <Card style={styles.list}>
            {collection.products.map((product, index) => (
              <ListRow
                key={product.id}
                image={product.image ?? null}
                title={product.name}
                meta={[product.brand, product.sku].filter(Boolean).join(' · ')}
                onPress={() => router.push(`/(tabs)/search?q=${encodeURIComponent(product.name)}`)}
                style={index > 0 ? styles.ruled : undefined}
              />
            ))}
          </Card>
        </View>
      ))}

      <Text style={styles.footnote}>
        Shops are ordered by how well they serve this address — not by what they pay.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  placeCard: { gap: 2 },
  placeHint: { ...typography.meta, color: colors.info, marginTop: spacing.xs },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  list: { paddingVertical: spacing.xs },
  ruled: { borderTopWidth: 1, borderTopColor: colors.border },
  emptyActions: { gap: spacing.sm, alignSelf: 'stretch' },
  footnote: { ...typography.meta, textAlign: 'center' },

  // Merchandising (PHASE B). A banner is wide and shallow — a hero strip, not a
  // card in the list — so it is deliberately not a `Card`.
  bannerRow: { gap: spacing.md, paddingVertical: spacing.xs },
  bannerCard: {
    width: 280,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card
  },
  bannerImage: { width: '100%', height: 120, backgroundColor: colors.border },
  bannerText: { padding: spacing.md, gap: 2 },
  bannerTitle: { ...typography.cardTitle },
  bannerSubtitle: { ...typography.meta },
  bannerCode: {
    ...typography.meta,
    color: colors.ink,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: spacing.xs
  },
  collectionSubtitle: { ...typography.meta, marginTop: -spacing.sm, marginBottom: spacing.xs }
});
