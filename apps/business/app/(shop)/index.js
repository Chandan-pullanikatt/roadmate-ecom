// Shop Home — the designed Partner home screen (greeting → open toggle → stat
// tiles → quick actions), with one addition the designs could not have: a live
// banner for orders waiting on the 60-second window.
//
// The banner is not decoration. Until push lands, a shop that is not looking at
// the Orders tab has no idea an offer is counting down, and this is the screen
// the phone sits on.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  typography,
  Card,
  SectionHeader,
  GreetingHeader,
  StatGrid,
  StatTile,
  QuickActions,
  ListRow,
  StatusPill,
  EmptyState,
  Button,
  Banner,
  formatINR,
  prettyStatus,
  StateToggle
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';
import { billingBanner } from '../../src/billing.js';

export default function ShopHome() {
  const { user } = useSession();
  const api = useApi();
  const router = useRouter();

  const storefront = useResource(useCallback(() => api.getStorefront(), [api]));
  // The subscription strip. Polled with the slow group, not the 5-second offer
  // group: a trial ends on a day, not in a second.
  const billing = useResource(useCallback(() => api.getBilling(), [api]));
  const offers = useResource(useCallback(() => api.listOffers(), [api]), { intervalMs: POLL_MS.offers });
  const orders = useResource(useCallback(() => api.listOrders(), [api]), { intervalMs: POLL_MS.orders });

  const isOpen = storefront.data?.storefront?.isOpen ?? false;
  const offerList = offers.data?.offers ?? [];
  const orderList = orders.data?.orders ?? [];

  const active = orderList.filter((o) => ['ACCEPTED', 'PREPARING', 'READY'].includes(o.status));
  const delivered = orderList.filter((o) => o.status === 'DELIVERED');

  const banner = billingBanner(billing.data);

  const toggleOpen = (next) =>
    storefront.withPause(async () => {
      // Optimistic, because a toggle that lags feels broken — but the server's
      // answer is what is kept, and `withPause` refetches after it lands.
      storefront.setData({ storefront: { ...storefront.data?.storefront, isOpen: next } });
      await api.setStorefront({ isOpen: next });
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={
          <RefreshControl
            refreshing={offers.refreshing}
            onRefresh={() => {
              offers.reload();
              orders.reload();
              storefront.reload();
            }}
            tintColor={colors.accent}
          />
        }
      >
        <GreetingHeader
          name={user?.businessName || user?.name}
          hasAlerts={offerList.length > 0}
          onBellPress={() => router.push('/(shop)/orders')}
        />

        {/* Trial ending, or money owed. `billingBanner` returns null for the
            ordinary case — a partner in good standing does not need a strip on
            their home screen telling them they are a customer. */}
        {banner ? (
          <Banner
            message={banner.message}
            tone={banner.tone}
            action={banner.action}
            onAction={() => router.push('/subscription')}
          />
        ) : null}

        {/* Not on the map at all (PHASE A.1).
            This outranks the open/closed switch, because it makes that switch
            meaningless: `rankCandidateShops` prefilters on the lat/lng index, so
            a shop with no coordinates is matched by no customer's search however
            open and however stocked it is. Nothing else in this app would say so
            — the shop would simply never receive an offer and have no way to
            know why. It names who can fix it rather than offering a control the
            shop does not have: placing a shop is the operator's job, on the
            dashboard, where there is a map. */}
        {storefront.data?.storefront && storefront.data.storefront.locationSet === false ? (
          <Banner
            tone="danger"
            message={
              'This shop is not on the map, so no customer can find it. ' +
              'Ask your regional partner to set its location.'
            }
          />
        ) : null}

        {/* The switch out of the routing pool. `rankCandidateShops` only ever
            considers open shops, so this is not a display preference.

            `StateToggle` is shared with the Rider app's on-shift control: the same
            question with the same stakes — off, the platform sends you nothing —
            and it used to be a plain `Card` here and an accent-bordered one there,
            already drifted. See `packages/ui/src/StateToggle.js`. */}
        <StateToggle
          on={isOpen}
          onChange={toggleOpen}
          titleOn="Shop is open"
          titleOff="Shop is closed"
          metaOn={formatHours(storefront.data?.storefront) ?? 'Receiving customer orders'}
          metaOff="No new customer orders will reach you"
        />

        {offerList.length > 0 ? (
          <Card style={styles.alert} onPress={() => router.push('/(shop)/orders')}>
            <Text style={styles.alertTitle}>
              {offerList.length === 1 ? '1 order waiting for you' : `${offerList.length} orders waiting for you`}
            </Text>
            <Text style={styles.alertMeta}>
              Answer within the countdown or it goes to another shop.
            </Text>
            <Button label="Open" onPress={() => router.push('/(shop)/orders')} style={styles.alertButton} />
          </Card>
        ) : null}

        <StatGrid>
          <StatTile
            label="Waiting"
            value={String(offerList.length)}
            icon="prepTime"
            tone={offerList.length ? 'danger' : undefined}
            onPress={() => router.push('/(shop)/orders')}
          />
          <StatTile label="In progress" value={String(active.length)} icon="pending" onPress={() => router.push('/(shop)/orders')} />
          <StatTile label="Delivered" value={String(delivered.length)} icon="deliveries" />
        </StatGrid>

        <View>
          <SectionHeader title="Quick actions" />
          <QuickActions
            items={[
              { label: 'Stock', icon: 'stock', onPress: () => router.push('/(shop)/stock') },
              { label: 'Restock', icon: 'restock', onPress: () => router.push('/(shop)/restock') },
              { label: 'Redeem voucher', icon: 'voucher', onPress: () => router.push('/(shop)/vouchers') },
              { label: 'Orders', icon: 'orders', onPress: () => router.push('/(shop)/orders') }
            ]}
          />
        </View>

        <View>
          <SectionHeader title="Today's orders" action="See all" onAction={() => router.push('/(shop)/orders')} />
          <Card>
            {orderList.length === 0 ? (
              <EmptyState
                title="No orders yet"
                message={isOpen ? 'Customer orders will appear here as they come in.' : 'Your shop is closed.'}
              />
            ) : (
              orderList.slice(0, 5).map((order, index) => (
                <ListRow
                  key={order.id}
                  title={order.orderNumber}
                  subtitle={`${order.items.length} item${order.items.length === 1 ? '' : 's'}`}
                  meta={order.dropArea?.landmark ?? order.dropArea?.city ?? 'Counter'}
                  onPress={() => router.push(`/(shop)/order/${order.id}`)}
                  right={
                    <>
                      <StatusPill status={order.status} label={prettyStatus(order.status)} />
                      <Text style={typography.money}>{formatINR(order.grandTotal)}</Text>
                    </>
                  }
                  style={index > 0 && styles.divided}
                />
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const formatHours = (storefront) =>
  storefront?.openTime && storefront?.closeTime
    ? `${storefront.openTime} – ${storefront.closeTime}`
    : null;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },


  // ⚠️ Amber (2026-08-11), and the design system is what decides it, not taste:
  // `STATUS_TONES` in `tokens.js` already maps `OFFERED: 'warning'`, so an order
  // waiting on its window is amber everywhere else in the platform and must be
  // amber here.
  //
  // It was `accentSoft`, which stopped working the moment the open/closed toggle
  // above became a full accent wash — the transient thing that expires in sixty
  // seconds read as a washed-out copy of the steady state it sits under. Red was
  // the wrong correction: `Countdown` already escalates itself to red under a
  // third of the window, so a permanently red strip would spend most of its life
  // crying wolf and leave the real warning nowhere to go.
  alert: { backgroundColor: colors.warningSoft, gap: spacing.sm },
  alertTitle: { ...typography.sectionTitle, color: colors.warning },
  alertMeta: { ...typography.meta, color: colors.ink },
  alertButton: { marginTop: spacing.sm },

  divided: { borderTopWidth: 1, borderTopColor: colors.border }
});
