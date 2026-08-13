// One shop, as the design's Popular Shops row (the storefront pass, 2026-08-10).
//
// This replaces a generic `ListRow`, which put the shop's name, its distance and
// its opening hours in one grey meta line and stopped there. Every line below is
// a fact the customer decides on, and it was either missing or unreadable:
//
//   • **the picture** — `coverImageUrl` and `logoUrl` have been on `User` since
//     Phase 0 and the row rendered a 40 dp thumbnail of one of them
//   • **the rating** — was a pill only when set, and `prisma/seed.js` set none,
//     so no shop on the platform had ever shown a star
//   • **the ETA** — did not exist on this endpoint at all until today. It is now
//     the same number placement promises, from the same formula, so the card and
//     the confirmation cannot disagree two taps apart
//   • **free delivery** — a `PlatformConfig` row the client can move from the
//     Master screen; the app is told the threshold rather than hardcoding ₹199
//     into six builds, which is a promise that outlives the decision
//
// **Nothing here is invented when it is absent.** No rating renders no star, not
// "New"; no ETA renders no time, not an estimate. A card that fills its own gaps
// is a card that lies about the ones it cannot fill.
import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadow, VectorIcon, tileInk } from '@roadmate/ui';

export default function ShopCard({ shop, icon = 'storefront', tint = '#F1F3F6', ink = tileInk(0), freeDeliveryAbove, onPress }) {
  const image = shop.coverImageUrl || shop.logoUrl || null;

  // "20–39 Minutes" in the design is a range around the promise, not two
  // numbers the server sent. The window is ±25%, which is what makes it read as
  // an estimate — a bare "27 minutes" is a precision the platform does not have
  // and is the number a late delivery gets held to.
  const eta = Number.isFinite(shop.etaMin) ? shop.etaMin : null;
  const etaText = eta ? `${Math.max(5, Math.round(eta * 0.8))}–${Math.round(eta * 1.25)} mins` : null;

  const meta = [shop.distanceKm != null ? `${shop.distanceKm} km` : null, etaText]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${shop.name}${eta ? `, about ${eta} minutes away` : ''}`}
    >
      <View style={[styles.thumb, { backgroundColor: tint }]}>
        {image ? (
          // Clipped by its own radius, not by the parent — see `styles.thumb`.
          <Image source={{ uri: image }} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          // Not a broken-image box and not a grey rectangle: the industry's own
          // icon on its own tint, which is the same fallback the rails use and
          // makes an unphotographed shop look unphotographed rather than broken.
          <VectorIcon glyph={icon} size={30} color={ink} />
        )}

        {/* The design's ribbon. Shown only when the platform is actually running
            a free-delivery threshold — `freeDeliveryAbove` is null when the
            client has not set one, and "free delivery above ₹0" reads as "free
            delivery", which is a claim nobody made. */}
        {freeDeliveryAbove ? (
          <View style={styles.ribbon}>
            <Text style={styles.ribbonText}>FREE DELIVERY</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {shop.name}
          </Text>
          {shop.rating ? (
            <View style={styles.rating}>
              <Ionicons name="star" size={11} color="#FFFFFF" />
              <Text style={styles.ratingText}>{Number(shop.rating).toFixed(1)}</Text>
            </View>
          ) : null}
        </View>

        {meta ? <Text style={styles.meta}>{meta}</Text> : null}

        {shop.openTime && shop.closeTime ? (
          <Text style={styles.hours}>
            Open {shop.openTime}–{shop.closeTime}
          </Text>
        ) : null}

        {freeDeliveryAbove ? (
          <View style={styles.offer}>
            <Ionicons name="bicycle" size={12} color={colors.success} />
            <Text style={styles.offerText}>Free delivery above ₹{trimMoney(freeDeliveryAbove)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** "199.00" → "199". The server sends fixed-2 money; a threshold is a round number. */
function trimMoney(value) {
  const s = String(value);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow
  },
  pressed: { opacity: 0.9 },

  // ⚠️ No `overflow: 'hidden'`, for the reason written out at length in
  // `TaxonomyRail.js`: on Android a small `borderRadius` plus `overflow` clips
  // children through an arbitrary path rather than an oval, and that clip drops
  // a text glyph. This box shows a glyph whenever a shop has no photograph,
  // which is every shop until somebody uploads one.
  //
  // The two things that did need the clip carry their own corners instead: the
  // image has the radius on itself, and the ribbon rounds its own bottom two.
  thumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  thumbImage: { width: '100%', height: '100%', borderRadius: radius.md },
  ribbon: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(22,163,74,0.92)',
    paddingVertical: 3,
    alignItems: 'center',
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md
  },
  ribbonText: { fontSize: 8, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.6 },

  body: { flex: 1, justifyContent: 'center', gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  // Green pill with a white star — the convention every Indian food app has
  // trained people on. An accent-yellow star on a yellow-accented app would
  // disappear into the header.
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.success,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4
  },
  ratingText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },

  meta: { fontSize: 12, color: colors.inkMuted, fontWeight: '600' },
  hours: { fontSize: 11, color: colors.inkFaint },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  offerText: { fontSize: 11, fontWeight: '700', color: colors.success }
});
