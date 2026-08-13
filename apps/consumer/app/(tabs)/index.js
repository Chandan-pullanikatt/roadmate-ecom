// Home — where you are, what you are shopping for, and who can serve you.
//
// The whole screen is still one question asked of the server: `GET
// /api/customer/serviceable?lat&lng&industryId`. Everything above the shop list
// only decides those three parameters. What changed on 2026-08-10 is not the
// question but the shop *front* around it — see the note at the end of this
// header.
//
// **Serviceability is answered, not guessed, and it has two distinct nos.**
// `NO_SHOP` means nobody is in range; `NO_RIDER` means shops are in range but
// nobody can collect from them — which since 2026-08-08 also covers a
// self-delivering shop whose own delivery boys are all off shift (HANDOFF §3).
// They are different sentences to a customer and this screen says both, because
// "not available in your area" for what is really "come back in an hour" is how
// somebody deletes the app.
//
// ── THE STOREFRONT PASS (2026-08-10) ──────────────────────────────────────────
//
// This screen was correct and looked like a settings page. The client's words
// were "now it's a normal app"; the design (`designs/Customer.png`) has been
// sitting in the repo since Phase 4 and the screen was not built to it. Six
// things were wrong, and only one of them was styling:
//
//   1. **The address was a white card halfway down**, indistinguishable from the
//      content it governs — while being the one control that changes every
//      answer on the screen. It is now the accent bar at the top, which is where
//      every quick-commerce app in India puts it and therefore where people
//      look.
//   2. **The industry rail was seven text chips.** `Industry.iconUrl` had been
//      in the schema since Phase 0 with nothing able to write to it. There is
//      now an API for it, a Master screen behind that, and app-side artwork so
//      the rail is finished before anybody uploads anything (`src/art.js`).
//   3. **There was no category row at all** — `Category` had no customer
//      endpoint and no rows.
//   4. **A banner was a flat JPEG**, so no banner existed. It is now a composed
//      card and the demo seed can produce a full strip with no Cloudinary
//      account.
//   5. **A shop was a 40 dp thumbnail and a grey meta line.** No rating (none
//      was ever seeded), no ETA (the endpoint did not send one), no delivery
//      promise.
//   6. **A cart you had open was invisible** unless you went to the Cart tab.
//
// Two things this screen deliberately still does NOT do, both for reasons older
// than this pass: it renders no wishlist heart (there is no wishlist —
// `AppBar.js`), and a collection tile never adds to a cart (a collection is
// curation, not an offer to sell — `ProductTile.js`).
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  radius,
  typography,
  Card,
  SectionHeader,
  EmptyState,
  Banner,
  Button,
  SearchField,
  connectionMessage,
  SkeletonCard,
  tileTint,
  tileInk
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi } from '../../src/session.js';
import { usePlace } from '../../src/place.js';
import { POLL_MS, PREPAID_ENABLED } from '../../src/config.js';
import { formatAddress, isVoucherIndustry, isOrderable } from '../../src/order.js';
import { artFor } from '../../src/art.js';
import AppBar from '../../src/components/AppBar.js';
import TaxonomyRail from '../../src/components/TaxonomyRail.js';
import PromoCarousel from '../../src/components/PromoCarousel.js';
import ShopCard from '../../src/components/ShopCard.js';
import ProductTile from '../../src/components/ProductTile.js';
import CartBar from '../../src/components/CartBar.js';

export default function Home() {
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  // Which category tile is lit. Local to this screen and deliberately not in
  // `usePlace`: unlike the industry and the address, it changes nothing about
  // *what the platform can sell here* — it is a jump into the browse screen, and
  // a filter that survived a tab switch would silently narrow a later search.
  const [categoryId, setCategoryId] = React.useState(null);
  React.useEffect(() => setCategoryId(null), [industryId]);

  const serviceable = useResource(
    useCallback(
      () => (point ? api.getServiceable(point.lat, point.lng, industryId) : Promise.resolve(null)),
      [api, point, industryId]
    ),
    { intervalMs: POLL_MS.catalog, enabled: Boolean(point) && orderable, deps: [point?.lat, point?.lng, industryId] }
  );

  // Merchandising. All three are independent of serviceability on purpose: they
  // are the platform's editorial, not an offer to sell, so they render while the
  // shop list is still loading and they do not depend on a point.
  //
  // None of the three failures is surfaced. A home screen that cannot fetch its
  // banners is a home screen without banners — an error strip about promotional
  // artwork above a working shop list would be shouting about the wrong thing.
  const banners = useResource(
    useCallback(() => api.listBanners({ industryId }), [api, industryId]),
    { deps: [industryId] }
  );
  const collections = useResource(
    useCallback(() => api.listCollections({ industryId }), [api, industryId]),
    { deps: [industryId] }
  );
  const categories = useResource(
    useCallback(() => api.listCategories({ industryId }), [api, industryId]),
    { deps: [industryId] }
  );

  // The open baskets, for the bar at the bottom. Polled slowly and on purpose:
  // a cart only changes when this customer changes it, so this is a
  // came-back-to-the-app refresh rather than live data like stock is.
  const carts = useResource(useCallback(() => api.listCarts(), [api]), { intervalMs: 45_000 });

  const bannerList = banners.data?.banners ?? [];
  const collectionList = collections.data?.collections ?? [];
  const categoryList = categories.data?.categories ?? [];
  const shops = serviceable.data?.shops ?? [];
  const freeDeliveryAbove = serviceable.data?.freeDeliveryAbove ?? null;
  const problem = connectionMessage(serviceable.error);

  // The industry's own artwork, reused for every shop and product that has no
  // photograph of its own — so an unphotographed automobile shop shows a
  // rickshaw rather than a grey box.
  const industryIndex = Math.max(0, industries.findIndex((i) => i.id === industryId));
  const industryArt = industry ? artFor(industry, industryIndex, 'industry') : null;

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
   * end. The code is printed on the card instead.
   */
  const openBanner = (banner) => {
    const target = banner.target ?? {};
    if (target.type === 'SHOP') router.push(`/shop/${target.id}`);
    else if (target.type === 'PRODUCT' && target.label) {
      router.push(`/(tabs)/search?q=${encodeURIComponent(target.label)}`);
    }
  };

  const placeLabel = address
    ? `${address.label} · ${formatAddress(address)}`
    : pointSource === 'device'
      ? 'Your current location'
      : 'Choose an address';

  return (
    <View style={styles.screen}>
      <AppBar
        place={placeLabel}
        onPlace={() => router.push('/addresses')}
        onCart={() => router.push('/(tabs)/cart')}
        cartCount={(carts.data?.carts ?? []).filter((c) => c.items?.length).length}
      />

      <ScrollView
        contentContainerStyle={[styles.wrap, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={
          <RefreshControl
            refreshing={serviceable.refreshing}
            onRefresh={() => {
              serviceable.reload();
              banners.reload();
              collections.reload();
              categories.reload();
            }}
            tintColor={colors.accent}
          />
        }
      >
        {/* Seven industries, one row. The switcher filters — it never navigates. */}
        <TaxonomyRail
          items={industries}
          selectedId={industryId}
          onSelect={setIndustryId}
          kind="industry"
        />

        {/* The search box is a button here, not a field: browse-by-product is
            its own screen with its own state, and a second live search input on
            the home screen would be two places typing the same query. */}
        <View style={styles.searchWrap}>
          <SearchField
            placeholder={`Search in ${industryArt?.label ?? 'RoadMate'}`}
            value=""
            onChangeText={() => {}}
            onSubmit={() => router.push('/(tabs)/search')}
          />
          <View
            style={styles.searchOverlay}
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => router.push('/(tabs)/search')}
          />
        </View>

        {/* The promotional strip. Server-side the window is already applied, so
            anything here is live by definition — this screen knows nothing about
            dates and a festival banner disappears on its own. */}
        <PromoCarousel banners={bannerList} onOpen={openBanner} />

        {/* The category row. The industry's shape, not this address's inventory
            (server: `listCustomerCategories`) — so it renders whether or not
            anything is serviceable, and a tap jumps to browse-by-product filtered
            to it rather than filtering this page. */}
        {categoryList.length ? (
          <View style={styles.section}>
            <SectionHeader title={isVoucherIndustry(fulfilmentType) ? 'Browse memberships' : 'Shop by category'} />
            <TaxonomyRail
              items={categoryList}
              kind="category"
              allLabel="All"
              selectedId={categoryId}
              onSelect={(id) => {
                setCategoryId(id);
                if (id) router.push(`/(tabs)/search?categoryId=${id}`);
              }}
            />
          </View>
        ) : null}

        {problem ? (
          <View style={styles.gutter}>
            <Banner message={problem} action="Retry" onAction={() => serviceable.reload()} />
          </View>
        ) : null}

        {/* NO_DELIVERY is PREPAID-only on the server, so with no payment gateway
            configured a membership cannot be bought at all. Saying that here is
            better than a 422 at the last tap of a checkout. */}
        {isVoucherIndustry(fulfilmentType) && !PREPAID_ENABLED ? (
          <View style={styles.gutter}>
            <Banner
              tone="warning"
              message="Memberships are paid online, and online payment is not switched on yet. You can browse, but not buy."
            />
          </View>
        ) : null}

        <View style={styles.gutter}>
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
                title={serviceable.data.reason === 'NO_RIDER' ? 'Nobody can deliver right now' : 'Not here yet'}
                message={
                  serviceable.data.reason === 'NO_RIDER'
                    ? 'There are shops near you, but no delivery partner is on shift. This usually changes within the hour — try again shortly.'
                    : `No ${industry?.name?.toLowerCase() ?? ''} shop delivers to this address yet. Try another category, or another address.`
                }
                action={<Button label="Check again" variant="secondary" onPress={() => serviceable.reload()} />}
              />
            </Card>
          ) : (
            <View style={styles.section}>
              <SectionHeader
                title={isVoucherIndustry(fulfilmentType) ? 'Memberships near you' : 'Popular shops'}
                action={shops.length ? `${shops.length} near you` : undefined}
              />
              <View style={styles.shopList}>
                {shops.map((shop) => (
                  <ShopCard
                    key={shop.id}
                    shop={shop}
                    icon={industryArt?.icon ?? 'storefront'}
                    tint={industryArt?.tint ?? tileTint(0)}
                    ink={industryArt?.ink ?? tileInk(0)}
                    freeDeliveryAbove={freeDeliveryAbove}
                    onPress={() => router.push(`/shop/${shop.id}`)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Curated lists — "Items under ₹99", "Popular right now".
            ⚠️ These are the platform's *curation*, not an offer to sell: a
            collection lists products, and which shop near this customer has one
            in stock is a different question that the browse screens answer. So a
            tap goes to that product's shops and never straight into a cart. */}
        {collectionList.map((collection) => (
          <View key={collection.id} style={styles.section}>
            <View style={styles.gutter}>
              <SectionHeader title={collection.title} />
              {collection.subtitle ? (
                <Text style={styles.collectionSubtitle}>{collection.subtitle}</Text>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tileRow}>
              {collection.products.map((product) => (
                <ProductTile
                  key={product.id}
                  product={product}
                  icon={industryArt?.icon ?? 'bag-handle'}
                  tint={industryArt?.tint ?? tileTint(2)}
                  ink={industryArt?.ink ?? tileInk(2)}
                  onPress={() => router.push(`/(tabs)/search?q=${encodeURIComponent(product.name)}`)}
                />
              ))}
            </ScrollView>
          </View>
        ))}

        <Text style={styles.footnote}>
          Shops are ordered by how well they serve this address — not by what they pay.
        </Text>
      </ScrollView>

      <CartBar
        carts={carts.data?.carts}
        bottom={insets.bottom}
        onPress={() => router.push('/(tabs)/cart')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  wrap: { gap: spacing.lg, paddingTop: spacing.md },
  // Sections that scroll edge-to-edge (the rails, the carousel, the tile rows)
  // manage their own horizontal padding, so the page has none and anything that
  // needs it opts in. A page-level gutter is what forces every horizontal
  // scroller to end in a hard edge halfway across the screen.
  gutter: { paddingHorizontal: spacing.lg },
  section: { gap: spacing.sm },

  searchWrap: { paddingHorizontal: spacing.lg },
  // The field is rendered for its looks and covered by a transparent responder:
  // `SearchField` is a real `TextInput` and focusing it here would open a
  // keyboard over a screen with nothing to type into.
  searchOverlay: { ...StyleSheet.absoluteFillObject },

  shopList: { gap: spacing.md },
  tileRow: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  collectionSubtitle: { ...typography.meta, marginTop: -spacing.sm, marginBottom: spacing.xs },

  emptyActions: { gap: spacing.sm, alignSelf: 'stretch' },
  footnote: { ...typography.meta, textAlign: 'center', paddingHorizontal: spacing.lg }
});
