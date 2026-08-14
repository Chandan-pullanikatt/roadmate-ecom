// Profile — who you are, what you have done here, and the way out.
//
// ── WHAT WAS WRONG WITH IT ────────────────────────────────────────────────────
//
// The old screen was three grey cards and a red button, and its own header
// comment explained why: `Customer` is a phone number, an optional name and an
// optional email, there is no endpoint to change any of them, and rendering an
// "Edit" button over nothing would be a lie. That reasoning was right and the
// conclusion was wrong. **The account is thin; the customer's history is not.**
// Everything below already existed and none of it was on this screen:
//
//   • every order they have placed, with the discount frozen onto each one
//   • every address they have saved
//   • every offer live for them right now — an endpoint with no screen at all
//   • the baskets they have left open, which this app's one-cart-per-shop model
//     creates and which are invisible outside the Cart tab
//
// ── THE RULE THIS SCREEN KEEPS ────────────────────────────────────────────────
//
// **Every figure is a real fact, computed from data the server sent.** "Saved"
// is the sum of `discountAmount` over delivered orders — money that was frozen
// onto each order at delivery, not a recomputation of a live coupon. Nothing
// here is a badge, a tier, a streak or a points balance, because none of those
// exist on this platform, and a profile full of invented gamification is the
// exact opposite of polish. The screen looks generous because there was real
// material to show, not because figures were manufactured to fill tiles.
//
// ⚠️ `listOrders` returns the **most recent 50**. The totals are therefore
// "across your recent orders", and the screen says so rather than presenting a
// capped sum as a lifetime figure.
import React, { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Alert, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  radius,
  typography,
  shadow,
  GroupedCard,
  GroupedRow,
  SectionHeader,
  Gradient,
  initialsOf,
  formatINR,
  addMoney
} from '@roadmate/ui';
import { useResource } from '@roadmate/hooks';
import { useApi, useSession } from '../../src/session.js';
import { usePlace } from '../../src/place.js';
import { PREPAID_ENABLED } from '../../src/config.js';
import { formatAddress } from '../../src/order.js';

export default function Profile() {
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer, signOut } = useSession();
  const { address, addresses, industry } = usePlace();

  // Three reads, all of endpoints that already existed. None is polled: a
  // profile is not live data, and re-asking every 30 seconds for a page nobody
  // is watching is battery spent on nothing. Pull to refresh is the whole
  // refresh story here.
  // All three keys are shared with the screens those lists belong to — the
  // Orders tab, the Cart tab, the offers screen — because they are the same
  // questions. Profile is mostly counts over data another tab has usually
  // already fetched, so it should not be sitting on a spinner to show them.
  const orders = useResource(useCallback(() => api.listOrders(), [api]), { cacheKey: 'orders' });
  const carts = useResource(useCallback(() => api.listCarts(), [api]), { cacheKey: 'carts' });
  const offers = useResource(useCallback(() => api.listCoupons({}), [api]), {
    cacheKey: 'coupons-all'
  });

  const stats = useMemo(() => summarise(orders.data?.orders ?? []), [orders.data]);
  const openCarts = (carts.data?.carts ?? []).filter((c) => c.items?.length).length;
  const offerCount = (offers.data?.coupons ?? []).length;

  const name = customer?.name || 'RoadMate customer';

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You will need your phone number and a new code to sign back in.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut }
    ]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.wrap, { paddingBottom: insets.bottom + spacing.xxl }]}
        refreshControl={
          <RefreshControl
            refreshing={orders.refreshing}
            onRefresh={() => {
              orders.reload();
              carts.reload();
              offers.reload();
            }}
            tintColor={colors.accent}
          />
        }
      >
        {/* The header runs to the top edge of the glass in the accent, exactly
            like the home screen's — the two are one app and a grey settings page
            behind a yellow storefront reads as a different product. */}
        <Gradient
          colors={[colors.accent, colors.accentDim]}
          direction="vertical"
          // 40 rather than the default 24. This is the largest gradient in the
          // app — a full-width header, not a 132 dp card — and accent→accentDim
          // moves 144 points of blue across it, which at 24 bands is a 2.5% step
          // per band and close enough to visible on a flat area this size. At 40
          // it is 1.4%, in line with every banner card.
          steps={40}
          style={[styles.header, { paddingTop: insets.top + spacing.xl }]}
        >
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(name)}</Text>
            </View>
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.phone}>+91 {customer?.phone}</Text>
              {/* A real stored fact, not a computed one. Absent on an account
                  old enough to predate the field rather than guessed. */}
              {formatMonth(customer?.createdAt) ? (
                <Text style={styles.since}>Member since {formatMonth(customer.createdAt)}</Text>
              ) : null}
            </View>
          </View>
        </Gradient>

        {/* The stat row overlaps the header, which is what ties the two together
            — a card floating in the gap below would read as the start of the
            list rather than as part of the identity. */}
        <View style={styles.statRow}>
          <Stat
            icon="receipt-outline"
            label="Orders"
            value={orders.loading && !orders.data ? '—' : String(stats.total)}
            onPress={() => router.push('/(tabs)/orders')}
          />
          <Stat
            icon="pricetag-outline"
            label="Saved"
            // Zero is shown as ₹0, never hidden: "you have saved nothing yet" is
            // a true and useful thing to learn on a screen that also links to
            // the offers that would change it.
            value={orders.loading && !orders.data ? '—' : formatINR(stats.saved, { paise: false })}
            tone={Number(stats.saved) > 0 ? 'success' : undefined}
            onPress={() => router.push('/offers')}
          />
          <Stat
            icon="location-outline"
            label="Addresses"
            value={String(addresses.length)}
            onPress={() => router.push('/addresses')}
          />
        </View>

        <View style={styles.body}>
          {/* An open basket is this app's one genuinely surprising state: carts
              are per shop and never merge, so a customer can be carrying baskets
              they have forgotten. Surfaced here as a nudge, not as an error. */}
          {openCarts > 0 ? (
            <Pressable style={styles.nudge} onPress={() => router.push('/(tabs)/cart')}>
              <View style={styles.nudgeIcon}>
                <Ionicons name="basket" size={17} color={colors.onAccent} />
              </View>
              <View style={styles.nudgeText}>
                <Text style={styles.nudgeTitle}>
                  {openCarts === 1 ? 'You have a basket waiting' : `${openCarts} baskets waiting`}
                </Text>
                <Text style={styles.nudgeMeta}>
                  {openCarts === 1
                    ? 'Nothing is reserved until you place the order.'
                    : 'One basket per shop — each is a separate delivery.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
            </Pressable>
          ) : null}

          <View>
            <SectionHeader title="Ordering" />
            <GroupedCard>
              <GroupedRow
                label="Your orders"
                sublabel={
                  stats.total
                    ? `${stats.delivered} delivered${stats.active ? ` · ${stats.active} on the way` : ''}`
                    : 'Nothing yet'
                }
                onPress={() => router.push('/(tabs)/orders')}
              />
              <GroupedRow
                label="Offers for you"
                sublabel={
                  offers.loading && !offers.data
                    ? 'Checking…'
                    : offerCount
                      ? `${offerCount} live right now`
                      : 'None running at the moment'
                }
                right={
                  offerCount ? (
                    <View style={styles.count}>
                      <Text style={styles.countText}>{offerCount}</Text>
                    </View>
                  ) : null
                }
                onPress={() => router.push('/offers')}
              />
              <GroupedRow
                label="Delivery address"
                sublabel={address ? formatAddress(address) : 'Not chosen yet'}
                onPress={() => router.push('/addresses')}
              />
            </GroupedCard>
          </View>

          <View>
            <SectionHeader title="Account" />
            <GroupedCard>
              <GroupedRow label="Mobile" value={`+91 ${customer?.phone ?? ''}`} />
              {/* Both optional on `Customer`, and there is still no endpoint to
                  change either. Shown when set and simply absent when not —
                  which is honest, and better than an "Add email" row that opens
                  nothing. */}
              {customer?.name ? <GroupedRow label="Name" value={customer.name} /> : null}
              {customer?.email ? <GroupedRow label="Email" value={customer.email} /> : null}
              <GroupedRow label="Shopping in" value={industry?.name ?? '—'} />
              <GroupedRow
                label="Payment"
                // Not a preference — a fact about the platform right now. Saying
                // it here stops it being a surprise at the last tap of checkout.
                value={PREPAID_ENABLED ? 'Cash or online' : 'Cash on delivery'}
              />
            </GroupedCard>
          </View>

          <View>
            <SectionHeader title="About" />
            <GroupedCard>
              <GroupedRow
                label="Delivering, or running a shop?"
                sublabel="Delivery partners use RoadMate Rider. Shops use RoadMate Shop."
              />
              <GroupedRow label="Version" value="1.0.0" />
              <GroupedRow label="Sign out" tone="danger" onPress={confirmSignOut} />
            </GroupedCard>
          </View>

          {stats.total > 0 ? (
            <Text style={styles.footnote}>
              Figures cover your {stats.total} most recent order{stats.total === 1 ? '' : 's'}.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, label, value, tone, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.stat, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Ionicons name={icon} size={16} color={colors.inkMuted} />
      <Text style={[styles.statValue, tone === 'success' && { color: colors.success }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The three numbers, from the orders the server already sent.
 *
 * **`saved` counts DELIVERED orders only.** `discountAmount` is frozen onto an
 * order when it is placed, but an order that was cancelled or is still routing
 * saved the customer nothing — counting it would inflate the figure and then
 * silently deflate it when something got cancelled, which is worse than never
 * having shown it. Summed with `addMoney`, in integer paise: these are fixed-2
 * strings and `+` on them is how a rupee goes missing.
 */
function summarise(orders) {
  let saved = '0.00';
  let delivered = 0;
  let active = 0;

  for (const order of orders) {
    if (order.status === 'DELIVERED') {
      delivered += 1;
      if (order.discountAmount) saved = addMoney(saved, order.discountAmount);
    } else if (order.status !== 'CANCELLED') {
      active += 1;
    }
  }

  return { total: orders.length, delivered, active, saved };
}

/**
 * "2026-03-14T…" → "March 2026".
 *
 * Written out rather than `toLocaleDateString('en-IN', …)`: Hermes only has full
 * `Intl` where the platform's ICU is available, and a build without it silently
 * falls back to a format nobody chose — which for a date is a wrong-looking line
 * rather than a crash, and so is never reported. The app is English-only today;
 * when it is not, this becomes a real localisation decision rather than an
 * accident of which engine shipped.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatMonth(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  wrap: { paddingBottom: spacing.xxl },

  // Deep enough that the overlapping stat row still leaves the identity block
  // clear of it.
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl + spacing.xl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: { fontSize: 22, fontWeight: '800', color: colors.ink },
  identityText: { flex: 1, gap: 1 },
  name: { fontSize: 20, fontWeight: '800', color: colors.onAccent },
  phone: { fontSize: 13, fontWeight: '600', color: 'rgba(26,26,26,0.72)' },
  since: { fontSize: 11, color: 'rgba(26,26,26,0.58)', marginTop: 2 },

  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    // Pulls the row up over the header's bottom edge.
    marginTop: -(spacing.xxl + spacing.sm)
  },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
    ...shadow
  },
  statValue: { fontSize: 17, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 11, color: colors.inkMuted, fontWeight: '600' },

  body: { padding: spacing.lg, gap: spacing.xl },

  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md
  },
  nudgeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  nudgeText: { flex: 1, gap: 1 },
  nudgeTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  nudgeMeta: { fontSize: 11, color: colors.inkMuted },

  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  countText: { fontSize: 11, fontWeight: '800', color: colors.onAccent },

  footnote: { ...typography.meta, textAlign: 'center' }
});
