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
// One thing this screen deliberately still does NOT do, for a reason older than
// this pass: it renders no wishlist heart, because there is no wishlist
// (`AppBar.js`).
//
// ── THE COLLECTION TILES (2026-08-14) ─────────────────────────────────────────
//
// A collection tile used to be navigation only, and it navigated to the wrong
// place twice over. Both faults were on the same tap and are worth naming
// separately, because only one of them was a bug:
//
//   • **The bug.** A collection with no `industryId` is platform-wide by design,
//     but its *products* are not. "Items under ₹99", built from the whole
//     catalogue, offered tomatoes to somebody browsing Sports — and the tap went
//     to a search screen filtered to Sports, which could only answer "nothing
//     matching tomatoes". A dead end reached from the home screen.
//   • **The design.** Even when the product was right, buying it was home →
//     search → shop → add. The middle screen answers "who near me sells this",
//     which is a real question and not one the customer had asked.
//
// The server now answers both when this screen sends a point (`listCollections`
// with `lat`/`lng`): items are scoped to the industry, and each carries the
// nearest buyable offer. So a tile adds in one tap when nothing is left to
// choose, and otherwise opens that shop's shelf rather than a search box.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
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
import { formatAddress, isVoucherIndustry, isBookingIndustry, isOrderable } from '../../src/order.js';
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
    {
      intervalMs: POLL_MS.catalog,
      enabled: Boolean(point) && orderable,
      deps: [point?.lat, point?.lng, industryId],
      // Switching the industry rail used to blank this whole page — four
      // resources reset to null at once while five requests flew. Cached per
      // point-and-industry, tapping back to a rail you have already seen paints
      // the shops you saw, then corrects them a moment later.
      cacheKey: 'serviceable'
    }
  );

  // Merchandising. All three are independent of *serviceability* on purpose:
  // they are the platform's editorial, so they render while the shop list is
  // still loading and while the answer is NO_RIDER.
  //
  // None of the three failures is surfaced. A home screen that cannot fetch its
  // banners is a home screen without banners — an error strip about promotional
  // artwork above a working shop list would be shouting about the wrong thing.
  const banners = useResource(
    useCallback(() => api.listBanners({ industryId }), [api, industryId]),
    { deps: [industryId], cacheKey: 'banners' }
  );
  // Collections are the one exception to "independent of the point": the point
  // is what lets the server resolve who sells each item, which is what turns a
  // tile from a signpost into a thing you can buy. It stays optional — without
  // an address the list still renders, just without Add buttons.
  const collections = useResource(
    useCallback(
      () => api.listCollections({ industryId, lat: point?.lat, lng: point?.lng }),
      [api, industryId, point?.lat, point?.lng]
    ),
    { deps: [industryId, point?.lat, point?.lng], cacheKey: 'collections' }
  );
  const categories = useResource(
    useCallback(() => api.listCategories({ industryId }), [api, industryId]),
    { deps: [industryId], cacheKey: 'categories' }
  );

  // The open baskets, for the bar at the bottom. Polled slowly and on purpose:
  // a cart only changes when this customer changes it, so this is a
  // came-back-to-the-app refresh rather than live data like stock is.
  // ⚠️ The cache key is shared with the Cart tab, Profile and Checkout, and that
  // is the point: all four ask `listCarts()` with no arguments, so they are one
  // question. The bar at the bottom of this screen is then already drawn when
  // somebody arrives from the cart they were just looking at.
  const carts = useResource(useCallback(() => api.listCarts(), [api]), {
    intervalMs: 45_000,
    cacheKey: 'carts'
  });

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

  /**
   * Where a collection tile goes when it is tapped rather than added.
   *
   * With a resolved offer this is the shop that offer came from, opened on that
   * product — the screen with the variant picker and the add-on groups on it,
   * which is precisely why the tile declined to add for itself. Without one
   * (no address yet) it falls back to browse-by-product, which is the screen
   * that exists to find out who sells this at all.
   */
  const openCollectionProduct = (product) => {
    const query = encodeURIComponent(product.name);
    if (product.offer) router.push(`/shop/${product.offer.shopId}?q=${query}`);
    else router.push(`/(tabs)/search?q=${query}`);
  };

  /**
   * One tap, one line in a basket at that shop.
   *
   * The 409 is the shelf answering with what it has left, and it is worth an
   * alert rather than a silent no: "only 2 left" is the shop talking, and a
   * button that just sprang back to ADD would read as the app being broken.
   * Re-thrown so the tile drops out of its `done` state.
   */
  const addFromCollection = async (product, offer) => {
    try {
      await api.addCartItem({
        shopId: offer.shopId,
        productId: product.id,
        variantId: offer.variantId,
        quantity: 1
      });
      // The bar at the bottom is the receipt. Its poll is 45s — far too slow to
      // be the feedback for something the customer just did.
      carts.reload();
    } catch (error) {
      Alert.alert('Could not add that', connectionMessage(error) ?? 'Please try again.');
      throw error;
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
            <SectionHeader
              title={
                isBookingIndustry(fulfilmentType)
                  ? 'Browse venues'
                  : isVoucherIndustry(fulfilmentType)
                    ? 'Browse memberships'
                    : 'Shop by category'
              }
            />
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

        {/* Both self-collected types are PREPAID-only on the server, so with no
            payment gateway configured neither a membership nor a booking can be
            bought at all. Saying that here is better than a 422 at the last tap
            of a checkout. */}
        {isVoucherIndustry(fulfilmentType) && !PREPAID_ENABLED ? (
          <View style={styles.gutter}>
            <Banner
              tone="warning"
              message={
                isBookingIndustry(fulfilmentType)
                  ? 'Bookings are paid online, and online payment is not available in this app right now. You can browse the times, but not book one.'
                  : 'Memberships are paid online, and online payment is not available in this app right now. You can browse, but not buy.'
              }
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
                title={
                  isBookingIndustry(fulfilmentType)
                    ? 'Venues near you'
                    : isVoucherIndustry(fulfilmentType)
                      ? 'Memberships near you'
                      : 'Popular shops'
                }
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
            Still the platform's curation, and still scoped by the server rather
            than here: this screen never filters or reorders what came back. See
            the collection-tile note in this file's header for what a tap does
            and, more importantly, when it refuses to add. */}
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
                  offer={product.offer ?? null}
                  icon={industryArt?.icon ?? 'bag-handle'}
                  tint={industryArt?.tint ?? tileTint(2)}
                  ink={industryArt?.ink ?? tileInk(2)}
                  onPress={() => openCollectionProduct(product)}
                  onAdd={(offer) => addFromCollection(product, offer)}
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
