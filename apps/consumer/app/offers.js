// The offers a customer can actually use.
//
// ── WHY THIS SCREEN EXISTS ────────────────────────────────────────────────────
//
// `GET /api/customer/coupons` was built in PHASE A.3 for exactly this and has
// never had a screen. HANDOFF §6 records the problem it was meant to solve:
// before that endpoint a coupon could only be used by somebody who had already
// been *told* its code out of band, which made every offer the platform ran
// invisible to everybody else. Half of that fix shipped. This is the other half.
//
// ── TWO THINGS THIS SCREEN MUST NOT CLAIM ─────────────────────────────────────
//
//   • **It does not promise a code will apply.** `resolveCoupon()` at checkout is
//     the authority and re-checks everything against the real cart. This list
//     only hides what is *certainly* unusable — in particular an offer whose
//     `minOrderValue` the cart has not reached is still listed, because a
//     customer ₹40 short should be told to add ₹40 of items, not shown nothing.
//     So every card says what it needs rather than saying "available".
//
//   • **It never says how many are left.** `usageLimit`, `perUserLimit` and the
//     counts are deliberately not sent by the server: how much of an offer
//     remains is the platform's commercial information, and publishing it
//     invites exactly the rush it describes. Nothing here tries to infer it.
//
// An `autoApply` coupon shows no code at all, because there is nothing to type —
// the best one is applied at checkout by `resolveCoupon` itself. Printing a code
// next to it would invite somebody to enter an offer they already have.
import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  colors,
  spacing,
  radius,
  typography,
  shadow,
  Card,
  EmptyState,
  Banner,
  Button,
  connectionMessage,
  SkeletonCard,
  formatINR,
} from "@roadmate/ui";
import { useResource } from "@roadmate/hooks";
import { useApi } from "../src/session.js";
import { usePlace } from "../src/place.js";

export default function Offers() {
  const api = useApi();
  const router = useRouter();
  const { industryId } = usePlace();

  const offers = useResource(
    useCallback(() => api.listCoupons({ industryId }), [api, industryId]),
    { deps: [industryId], cacheKey: 'coupons-by-industry' },
  );

  const list = offers.data?.coupons ?? [];
  const problem = connectionMessage(offers.error);

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={
        <RefreshControl
          refreshing={offers.refreshing}
          onRefresh={() => offers.reload()}
          tintColor={colors.accent}
        />
      }
    >
      {problem ? (
        <Banner
          message={problem}
          action="Retry"
          onAction={() => offers.reload()}
        />
      ) : null}

      {offers.loading && !offers.data ? (
        <SkeletonCard count={3} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title="No offers running right now"
            message="Offers come and go. When one is live for your area it shows up here, and the best one you qualify for is applied at checkout automatically."
            action={
              <Button
                label="Back to shopping"
                variant="secondary"
                onPress={() => router.push("/(tabs)")}
              />
            }
          />
        </Card>
      ) : (
        list.map((coupon) => <OfferCard key={coupon.code} coupon={coupon} />)
      )}

      <Text style={styles.footnote}>
        Offers are checked again when you place the order — that is what decides
        which one you get.
      </Text>
    </ScrollView>
  );
}

function OfferCard({ coupon }) {
  // The headline. `discountType` is the server's enum; the money is a fixed-2
  // string that `formatINR` renders without ever parsing it to a float.
  const headline =
    coupon.discountType === "PERCENT"
      ? `${trim(coupon.discountValue)}% OFF`
      : `${formatINR(coupon.discountValue, { paise: false })} OFF`;

  const conditions = [
    coupon.minOrderValue && Number(coupon.minOrderValue) > 0
      ? `on orders above ${formatINR(coupon.minOrderValue, { paise: false })}`
      : null,
    coupon.discountType === "PERCENT" &&
    coupon.maxDiscount &&
    Number(coupon.maxDiscount) > 0
      ? `up to ${formatINR(coupon.maxDiscount, { paise: false })}`
      : null,
  ].filter(Boolean);

  return (
    <View style={styles.offer}>
      {/* The stub, like a real coupon. It is also what makes the discount the
          first thing read, ahead of the code — the figure is what a customer is
          deciding on, and the code is only the mechanism. */}
      <View style={styles.stub}>
        <Text style={styles.stubText} numberOfLines={2}>
          {headline}
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {coupon.title}
        </Text>
        {coupon.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {coupon.subtitle}
          </Text>
        ) : null}
        {conditions.length ? (
          <Text style={styles.conditions}>{conditions.join(" · ")}</Text>
        ) : null}

        <View style={styles.footer}>
          {coupon.autoApply ? (
            // No code, because there is nothing to type. `resolveCoupon` picks
            // the largest discount at checkout on its own.
            <View style={styles.auto}>
              <Ionicons name="flash" size={12} color={colors.success} />
              <Text style={styles.autoText}>Applied automatically</Text>
            </View>
          ) : (
            <View style={styles.code}>
              <Text style={styles.codeText}>{coupon.code}</Text>
            </View>
          )}

          {coupon.validTo ? (
            <Text style={styles.expiry}>Till {formatDay(coupon.validTo)}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** "20.00" → "20". A percentage is not money and does not want paise. */
const trim = (value) => String(value).replace(/\.00$/, "");

/**
 * "…-12-31T…" → "31 Dec". Spelled out rather than `toLocaleDateString`: Hermes
 * only has full `Intl` where the platform's ICU is available, and a build
 * without it quietly formats the date some other way — wrong-looking rather than
 * broken, and therefore never reported.
 */
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  offer: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    ...shadow,
  },
  // Accent block with ink on it — #DEBE10 is a mid-tone yellow and text on it is
  // always ink, never white (`colors.onAccent`).
  stub: {
    width: 96,
    backgroundColor: colors.accentSoft,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    // A solid hairline, not `borderStyle: 'dashed'`. Android draws a dashed
    // border as solid the moment `borderRadius` is non-zero, and a single dashed
    // side on a rounded box misrenders outright — so the "torn stub" effect is
    // built from the two rounded corners and this rule rather than from a
    // dash pattern that only appears on one platform.
    borderRightWidth: 1,
    borderRightColor: colors.accentDim,
  },
  stubText: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.onAccent,
    textAlign: "center",
  },

  body: { flex: 1, padding: spacing.lg, gap: 3 },
  title: { ...typography.cardTitle },
  subtitle: { ...typography.meta, lineHeight: 17 },
  conditions: { fontSize: 11, color: colors.inkFaint },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  code: {
    // Same reason as the stub: no dashed border on a rounded box.
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.page,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  codeText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: 1,
  },
  auto: { flexDirection: "row", alignItems: "center", gap: 4 },
  autoText: { fontSize: 11, fontWeight: "700", color: colors.success },
  expiry: { fontSize: 11, color: colors.inkFaint, marginLeft: "auto" },

  footnote: { ...typography.meta, textAlign: "center", marginTop: spacing.sm },
});
