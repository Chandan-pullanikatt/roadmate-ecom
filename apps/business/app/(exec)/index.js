// Executive Home — the partner dashboard, for all three executive roles.
//
// The tiles are not a fixed set: `dashboardController.getOverview` returns a
// *different set of keys per role*, so `src/roles.js` names the ones each role
// gets and this screen renders that list. Nothing here knows what a
// manufacturer is.
//
// **No commission percentage anywhere**, same rule as the shop's screens.
// `commission_percent` still defaults to the undocumented 15 from
// `orderController.js:196` (PLAN §7.1). Regional's `myShare` is safe to show
// and is shown: it is a figure the server computed and returned, not a rate
// this screen would be asserting.
//
// ── THE 2026-08-12 PASS ──────────────────────────────────────────────────────
//
// Four things were wrong, and three of them were structural rather than
// cosmetic. Written down because each is a rule, not a one-off tweak:
//
//  1. **Every figure was the same size**, so the ₹ figure the whole app exists
//     for was set at the weight of the product count. There is now a hero: one
//     headline (`config.headline`) on an ink card, with the counts as a divided
//     strip *inside* it. One object, one hierarchy — instead of four equal tiles
//     that made the reader do the ranking.
//  2. **"Quick actions" was four links to four tabs that were already on screen**
//     — Orders, Products, Network, Profile, all of them one tap away in the
//     bottom nav, directly beneath the row duplicating them. It is gone. In its
//     place is *Needs you*, which is the thing a partner actually opens this app
//     to find out: what is waiting on them, as rows they can act on.
//  3. **The list said "No orders yet" while the first fetch was still in
//     flight.** That is the exact lie `Skeleton.js` was written for, and this
//     screen never adopted it. It does now, and a failed *refresh* is a `Banner`
//     rather than a sentence hidden inside an empty state that no longer renders
//     once there is data.
//  4. **A trade order's direction was invisible.** A distributor is the seller on
//     one row and the buyer on the next (HANDOFF §1) — `getOrders` returns both
//     halves in one list — and the row drew them identically, so "₹1,06,500" gave
//     no clue whether that was money coming in or going out. Each row now carries
//     an in/out badge, for the roles that have a side.
import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  onDark,
  spacing,
  radius,
  typography,
  shadowLift,
  bannerTheme,
  Card,
  SectionHeader,
  GreetingHeader,
  StatusPill,
  EmptyState,
  Banner,
  connectionMessage,
  Gradient,
  Icon,
  containerStyle,
  Skeleton,
  SkeletonCard,
  toneColors,
  formatAmount,
  formatCompact
} from '@roadmate/ui';
import { useApi, useSession } from '../../src/session.js';
import { useResource } from '@roadmate/hooks';
import { POLL_MS } from '../../src/config.js';
import { roleConfig } from '../../src/roles.js';
import { counterpartyOf, partiesOf, isSeller, formatDate } from '../../src/tradeOrder.js';
import { billingBanner } from '../../src/billing.js';

export default function ExecHome() {
  const { user } = useSession();
  const api = useApi();
  const router = useRouter();
  const config = roleConfig(user?.role);

  const overview = useResource(useCallback(() => api.getOverview(), [api]), { intervalMs: POLL_MS.overview });
  // A Distributor and a Manufacturer are billed a monthly fee; a Regional
  // partner is not, and `getBilling` answers `billable: false` for them, which
  // `billingBanner` turns into no banner at all.
  const billing = useResource(useCallback(() => api.getBilling(), [api]));
  const orders = useResource(useCallback(() => api.listTradeOrders(), [api]), { intervalMs: POLL_MS.orders });
  const approvals = useResource(useCallback(() => api.getPendingApprovals(), [api]), {
    enabled: config.tabs.network
  });

  const stats = overview.data?.stats ?? {};
  const orderList = orders.data?.orders ?? [];
  const pending = approvals.data?.approvals ?? [];
  const banner = billingBanner(billing.data);

  // A seller's own queue. `getOrders` gives a distributor both halves — what it
  // bought and what it must ship — and "waiting on you" is only the second.
  const awaitingMe = config.sells
    ? orderList.filter((o) => o.sellerId === user?.id && ['Pending', 'Approved'].includes(o.status))
    : [];

  const reloadAll = () => {
    overview.reload();
    orders.reload();
    if (config.tabs.network) approvals.reload();
  };

  // Only once there is something on screen to be stale. Before the first
  // response lands the skeletons already say "this has not arrived"; a strip
  // above them saying it a second time is noise, and `EmptyState` below owns the
  // "we asked and got nothing" case.
  const stale = connectionMessage(overview.error ?? orders.error);
  const showStale = Boolean(stale) && Boolean(overview.data || orders.data);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={
          <RefreshControl refreshing={overview.refreshing} onRefresh={reloadAll} tintColor={colors.accent} />
        }
      >
        <GreetingHeader
          name={user?.businessName || user?.name}
          subtitle={identityLine(config, user)}
          hasAlerts={awaitingMe.length > 0 || pending.length > 0}
          onBellPress={() => router.push('/(exec)/orders')}
        />

        {banner ? (
          <Banner
            message={banner.message}
            tone={banner.tone}
            action={banner.action}
            onAction={() => router.push('/subscription')}
          />
        ) : null}

        {showStale ? <Banner message={stale} tone="warning" action="Retry" onAction={reloadAll} /> : null}

        <HeroCard
          headline={config.headline}
          stats={config.stats}
          values={stats}
          // Multi-industry from day one is a platform requirement (HANDOFF §1),
          // and until now no executive screen said which industry the account
          // trades in — it decides which catalogue, which partners and which
          // `PlatformConfig` overrides apply to every figure on this card.
          industry={user?.industry?.name}
          loading={overview.loading && !overview.data}
          onNavigate={(to) => router.push(to)}
        />

        <View>
          <SectionHeader title="Needs you" />
          <NeedsYou
            approvals={config.tabs.network ? pending.length : 0}
            toDispatch={awaitingMe.length}
            // ⚠️ `config.tabs.network &&` is load-bearing, not a tidy-up.
            // `useResource` only clears `loading` inside `load()`, and `load()`
            // never runs when `enabled` is false — so a **disabled** resource
            // reports `loading: true` forever. A Manufacturer has no network, so
            // without this guard its Needs-you section is a skeleton that never
            // resolves.
            loading={
              (config.tabs.network && approvals.loading && !approvals.data) || (orders.loading && !orders.data)
            }
            onApprovals={() => router.push('/(exec)/network')}
            onDispatch={() => router.push('/(exec)/orders')}
          />
        </View>

        <View>
          <SectionHeader title={config.ordersTitle} action="See all" onAction={() => router.push('/(exec)/orders')} />
          {orders.loading && !orders.data ? (
            <SkeletonCard count={3} />
          ) : orderList.length === 0 ? (
            <Card>
              <EmptyState
                title="No orders yet"
                message={
                  config.sells
                    ? 'Orders placed with you will appear here.'
                    : 'Trade in your region will appear here as it happens.'
                }
              />
            </Card>
          ) : (
            <Card style={styles.listCard}>
              {orderList.slice(0, 5).map((order, index) => (
                <TradeRow
                  key={order.id}
                  order={order}
                  userId={user?.id}
                  // A regional partner is on neither side of these orders, so an
                  // in/out badge would be claiming a position it does not hold.
                  showDirection={config.sells}
                  divided={index > 0}
                  onPress={() => router.push(`/(exec)/order/${order.id}`)}
                />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * "Distributor · Ernakulam" — which of the four business apps this is and which
 * account is in it. Four near-identical listings is HANDOFF §4's known cost, and
 * this is the cheapest possible mitigation: the answer, on the first screen.
 */
function identityLine(config, user) {
  return [config.label, user?.districtName || user?.regionName || user?.industry?.name]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The one figure that matters, and the counts that support it.
 *
 * ⚠️ **`Gradient`, never `expo-linear-gradient`.** A linear gradient is a native
 * view and adding the package breaks every installed dev client until it is
 * rebuilt — see the header of `packages/ui/src/Gradient.js`, which is the whole
 * reason that file exists.
 *
 * ⚠️ **No `overflow: 'hidden'` on this card**, for the reason `Gradient` records:
 * on Android a rounded clipping parent plus `elevation` drops non-image children
 * on re-render, and this card carries both. The bands round their own outer
 * corners, and the container's `backgroundColor` is the gradient's dark end so
 * the elevation shadow is cast by a correctly-rounded, correctly-coloured
 * outline.
 */
function HeroCard({ headline, stats, values, industry, loading, onNavigate }) {
  const theme = bannerTheme('ink');
  if (!headline) return null;

  const raw = values[headline.key];
  const value = headline.money ? formatCompact(raw ?? 0) : String(raw ?? 0);

  return (
    <View style={styles.hero}>
      <Gradient colors={[theme.from, theme.to]} direction="vertical" radius={radius.xl} style={styles.heroGradient}>
        <View style={styles.heroBody}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel} numberOfLines={1}>
              {headline.label.toUpperCase()}
            </Text>
            {industry ? (
              <View style={styles.industryChip}>
                <View style={styles.industryDot} />
                <Text style={styles.industryText} numberOfLines={1}>
                  {industry}
                </Text>
              </View>
            ) : null}
          </View>

          {loading ? (
            <Skeleton width={180} height={34} style={styles.heroSkeleton} />
          ) : (
            <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {value}
            </Text>
          )}

          {headline.caption ? <Text style={styles.heroCaption}>{headline.caption}</Text> : null}

          {stats.length > 0 ? (
            <View style={styles.heroStats}>
              {stats.map((stat, index) => (
                <MiniStat
                  key={stat.key}
                  stat={stat}
                  raw={values[stat.key]}
                  loading={loading}
                  first={index === 0}
                  onPress={stat.to ? () => onNavigate(stat.to) : undefined}
                />
              ))}
            </View>
          ) : null}
        </View>
      </Gradient>
    </View>
  );
}

/**
 * One count inside the hero.
 *
 * `actionable` is what makes this more than decoration: a non-zero "to dispatch"
 * is work, and it is drawn in the accent so it separates itself from the counts
 * that are merely facts. At zero it goes back to being white — an accent colour
 * that is always on means nothing.
 */
function MiniStat({ stat, raw, loading, first, onPress }) {
  const Container = onPress ? Pressable : View;
  const count = Number(raw ?? 0);
  const live = stat.actionable && count > 0;
  const value = stat.money ? formatCompact(raw ?? 0) : String(raw ?? 0);

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${stat.label}: ${value}`}
      style={containerStyle(
        ({ pressed } = {}) => [styles.miniStat, !first && styles.miniStatDivided, pressed && { opacity: 0.6 }],
        Boolean(onPress)
      )}
    >
      {loading ? (
        <Skeleton width={36} height={19} style={styles.heroSkeleton} />
      ) : (
        <Text
          style={[styles.miniValue, live && { color: colors.accent }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value}
        </Text>
      )}
      <View style={styles.miniLabelRow}>
        <Icon name={stat.icon} size={11} color={live ? colors.accent : onDark.muted} />
        <Text style={[styles.miniLabel, live && { color: colors.accent }]} numberOfLines={1}>
          {stat.label}
        </Text>
      </View>
    </Container>
  );
}

/**
 * What is waiting on this partner, as rows they can act on.
 *
 * This replaces the "Quick actions" row, which was four shortcuts to four tabs
 * rendered directly above the bottom nav containing the same four tabs. The
 * space is worth more spent on the question the tabs cannot answer.
 *
 * ⚠️ **The empty state is a state, not an absence.** Rendering nothing here
 * would be the same mistake the sold-out shelf row made (HANDOFF, "the live in
 * stock promise"): a partner who sees no tasks cannot tell "nothing is waiting"
 * from "this section did not load".
 */
function NeedsYou({ approvals, toDispatch, loading, onApprovals, onDispatch }) {
  if (loading) return <SkeletonCard count={2} thumb />;

  const tasks = [];
  if (approvals > 0) {
    tasks.push({
      key: 'approvals',
      tone: 'warning',
      icon: 'network',
      title: approvals === 1 ? '1 partner waiting for approval' : `${approvals} partners waiting for approval`,
      meta: 'They cannot trade until you approve them.',
      onPress: onApprovals
    });
  }
  if (toDispatch > 0) {
    tasks.push({
      key: 'dispatch',
      tone: 'info',
      icon: 'dispatch',
      title: toDispatch === 1 ? '1 order to dispatch' : `${toDispatch} orders to dispatch`,
      meta: 'Confirm and ship to keep your buyers stocked.',
      onPress: onDispatch
    });
  }

  if (tasks.length === 0) {
    return (
      <Card style={styles.listCard}>
        <TaskRow
          tone="success"
          icon="allClear"
          title="You are all caught up"
          meta="Approvals and orders waiting on you will show up here."
        />
      </Card>
    );
  }

  return (
    <Card style={styles.listCard}>
      {/* `key` is destructured out rather than spread: React 19 warns when a
          `key` arrives inside a spread object, because by then it has already
          been consumed as a prop and cannot be told apart from a real one. */}
      {tasks.map(({ key, ...task }, index) => (
        <TaskRow key={key} {...task} divided={index > 0} />
      ))}
    </Card>
  );
}

function TaskRow({ tone, icon, title, meta, onPress, divided }) {
  const Container = onPress ? Pressable : View;
  const { bg, fg } = toneColors(tone);
  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      // `containerStyle`, because the all-clear row has no `onPress` — see the
      // comment on it in `packages/ui/src/primitives.js`.
      style={containerStyle(
        ({ pressed } = {}) => [styles.taskRow, divided && styles.divided, pressed && { opacity: 0.85 }],
        Boolean(onPress)
      )}
    >
      <View style={[styles.taskIcon, { backgroundColor: bg }]}>
        <Icon name={icon} size={18} color={fg} />
      </View>
      <View style={styles.taskBody}>
        <Text style={typography.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={typography.meta} numberOfLines={2}>
          {meta}
        </Text>
      </View>
      {onPress ? <Icon name="forward" size={18} color={colors.inkFaint} /> : null}
    </Container>
  );
}

/**
 * One trade order.
 *
 * The counterparty leads, the order number does not. `#RM-SO-1786509691068-42`
 * is 22 characters of machine identifier, and putting it first — which is what
 * the old `title` string did — pushed "Ravipuram Auto Garage" onto a second line
 * and buried the only part of the row a human recognises. The number is still
 * here, and still the thing you quote on the phone; it is just no longer the
 * headline.
 */
function TradeRow({ order, userId, showDirection, divided, onPress }) {
  const selling = isSeller(order, userId);
  const items = order.items?.length ?? 0;
  // `showDirection` is really "is this reader a party to the order". A
  // participant gets the other side's name and an in/out badge; an observer — a
  // regional partner, watching its region — gets both names in chain order,
  // because one bare name tells a bystander nothing about who paid whom.
  const who = showDirection ? counterpartyOf(order, userId) : partiesOf(order);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.tradeRow, divided && styles.divided, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.tradeHead}>
        {showDirection ? (
          <View style={[styles.direction, { backgroundColor: selling ? colors.successSoft : colors.infoSoft }]}>
            <Icon
              name={selling ? 'outbound' : 'inbound'}
              size={13}
              color={selling ? colors.success : colors.info}
            />
          </View>
        ) : null}
        {/* Two lines for the observer form: "Deccan Auto Distributors → Ravipuram
            Auto Garage" is two business names and will not fit on one, and
            truncating it would cut the buyer off — the half a bystander cannot
            infer. */}
        <Text style={styles.tradeName} numberOfLines={showDirection ? 1 : 2}>
          {who}
        </Text>
        <StatusPill status={order.status} />
      </View>

      <Text style={typography.sku} numberOfLines={1}>
        {order.orderNumber}
      </Text>

      <View style={styles.tradeFoot}>
        <Text style={typography.meta} numberOfLines={1}>
          {formatDate(order.createdAt)} · {items} item{items === 1 ? '' : 's'}
        </Text>
        <Text style={typography.money}>{formatAmount(order.totalAmount)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  wrap: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },

  // The hero. `shadowLift` rather than `shadow` — this is the one element on the
  // page that sits above it rather than on it (HANDOFF §5: two elevations, and
  // only two).
  hero: {
    borderRadius: radius.xl,
    // The gradient's dark end, so the Android elevation outline is cast by a
    // shape that is both correctly rounded and the right colour.
    backgroundColor: bannerTheme('ink').to,
    ...shadowLift
  },
  heroGradient: { borderRadius: radius.xl },
  heroBody: { padding: spacing.xl, gap: spacing.xs },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: 2 },
  heroLabel: { ...typography.sku, color: onDark.muted, flex: 1 },
  industryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '55%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: onDark.fill
  },
  industryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  industryText: { fontSize: 11, fontWeight: '600', color: onDark.text, flexShrink: 1 },
  heroValue: { fontSize: 34, fontWeight: '800', color: onDark.text, letterSpacing: -0.5 },
  heroCaption: { fontSize: 12, color: onDark.muted, lineHeight: 17 },
  heroSkeleton: { backgroundColor: onDark.fill },

  heroStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: onDark.rule
  },
  miniStat: { flex: 1, gap: spacing.xs, paddingHorizontal: spacing.sm },
  // The separator is the *left* border of every tile but the first, so a row of
  // three has two rules rather than a trailing one against the card edge.
  miniStatDivided: { borderLeftWidth: 1, borderLeftColor: onDark.rule },
  miniValue: { fontSize: 19, fontWeight: '700', color: onDark.text },
  miniLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniLabel: { fontSize: 11, fontWeight: '600', color: onDark.muted, flexShrink: 1 },

  // A card whose children are rows: the padding belongs to each row, so a
  // divider can run the full width instead of stopping short of it.
  listCard: { padding: 0 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },

  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg
  },
  taskIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  taskBody: { flex: 1, gap: 2 },

  tradeRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 3 },
  tradeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  direction: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tradeName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  tradeFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: 2
  }
});
