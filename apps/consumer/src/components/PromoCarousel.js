// The promotional strip (the storefront pass, 2026-08-10).
//
// ── WHAT CHANGED, AND WHY IT MATTERS MORE THAN IT LOOKS ───────────────────────
//
// A banner used to *be* a flat JPEG: `Banner.imageUrl` was required, the card
// rendered image-on-top with the text beneath it, and the whole strip was
// therefore blocked on somebody opening a design tool. Two consequences, and the
// second is the expensive one:
//
//   • **No banner could exist**, so the home screen had no promotional layer at
//     all — the model, the API and the Master screen had all shipped in PHASE B
//     and never had a row.
//   • **A headline set in a JPEG cannot re-wrap.** It is one fixed pixel width
//     against every phone from a 320 dp budget Android to a tablet, it ignores
//     the type scale, it ignores the system font size a partially-sighted
//     customer has set, and it is invisible to a screen reader.
//
// So the card is **composed**: the theme paints it, the title and subtitle are
// real text, and `imageUrl` is optional artwork sitting on the right. A banner
// with no image is a complete, designed banner — which is what lets the demo
// seed produce a finished shop front with an empty Cloudinary account.
//
// ── THE THEME IS A KEY, NEVER A COLOUR ────────────────────────────────────────
//
// `bannerTheme()` resolves it out of `packages/ui/src/tokens.js`, and the server
// refuses an unknown one. A hex code in the database would be a card nobody can
// restyle that ignores every contrast decision the token file makes — which is
// exactly why the `ink` theme carries white text and the other five carry dark:
// contrast is a property of the pair, not of the background.
//
// ⚠️ The background is `Gradient` from `@roadmate/ui` and **not**
// `expo-linear-gradient`. The native package was tried first and broke every
// phone with an existing dev client installed — a linear gradient is a native
// view, so the JS bundle referenced a `ViewManager` the APK had never heard of
// and the app crashed at the first banner. See `packages/ui/src/Gradient.js`;
// it is the same call HANDOFF §6 records for the rider's signature capture.
import React, { useRef, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, spacing, radius, shadowLift, bannerTheme, Gradient } from '@roadmate/ui';

export default function PromoCarousel({ banners, onOpen }) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scroller = useRef(null);

  if (!banners?.length) return null;

  // The card is the screen minus the page gutters. Computed rather than fixed,
  // because a 280 dp card that pages by 280 dp on a 412 dp phone leaves a strip
  // of the next banner permanently on screen and never settles.
  const cardWidth = width - spacing.lg * 2;
  const step = cardWidth + spacing.md;

  return (
    <View>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        // `snapToInterval` rather than `pagingEnabled`: the card is narrower than
        // the screen, so paging by screen-widths would skip the gutter and drift
        // a little further out of alignment with every swipe.
        snapToInterval={step}
        decelerationRate="fast"
        snapToAlignment="start"
        contentContainerStyle={styles.row}
        onMomentumScrollEnd={(e) => {
          setPage(Math.round(e.nativeEvent.contentOffset.x / step));
        }}
      >
        {banners.map((banner) => (
          <PromoCard
            key={banner.id}
            banner={banner}
            width={cardWidth}
            onPress={() => onOpen?.(banner)}
          />
        ))}
      </ScrollView>

      {/* Dots only when there is more than one. A single dot under a single
          banner tells the customer nothing and looks like a broken carousel. */}
      {banners.length > 1 ? (
        <View style={styles.dots}>
          {banners.map((banner, index) => (
            <View key={banner.id} style={[styles.dot, index === page && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PromoCard({ banner, width, onPress }) {
  const theme = bannerTheme(banner.theme);

  // A banner that opens nothing is legitimate — an announcement, not an advert
  // (server: `targetOf` returns `NONE`). It is rendered as a card and not as a
  // button, so it neither invites a tap nor swallows one.
  const opens = banner.target?.type && banner.target.type !== 'NONE';
  const Container = opens ? Pressable : View;

  return (
    <Container
      onPress={opens ? onPress : undefined}
      style={[styles.card, { width }]}
      accessibilityRole={opens ? 'button' : undefined}
      accessibilityLabel={[banner.title, banner.subtitle].filter(Boolean).join('. ')}
    >
      <Gradient
        colors={[theme.from, theme.to]}
        direction="horizontal"
        // The gradient rounds its own end bands rather than the card clipping
        // it. The card carries `shadowLift` (elevation 8, the highest in the
        // app), and elevation plus a small-radius `overflow: 'hidden'` is the
        // exact combination that emptied the industry tiles — see `Gradient.js`.
        radius={radius.xl}
        style={styles.fill}
      >
        <View style={styles.body}>
          <View style={styles.text}>
            <Text style={[styles.title, { color: theme.ink }]} numberOfLines={2}>
              {banner.title}
            </Text>
            {banner.subtitle ? (
              <Text style={[styles.subtitle, { color: theme.sub }]} numberOfLines={2}>
                {banner.subtitle}
              </Text>
            ) : null}

            {/* A coupon banner prints its code rather than navigating: the offer
                is applied at checkout, so sending somebody to a cart they have
                not filled is a dead end (the same call the old strip made). */}
            {banner.target?.type === 'COUPON' && banner.target.code ? (
              <View style={[styles.code, { borderColor: theme.ink }]}>
                <Text style={[styles.codeText, { color: theme.ink }]}>Use {banner.target.code}</Text>
              </View>
            ) : banner.ctaLabel && opens ? (
              <View style={[styles.cta, { backgroundColor: theme.button }]}>
                <Text style={[styles.ctaText, { color: theme.onButton }]}>{banner.ctaLabel}</Text>
              </View>
            ) : null}
          </View>

          {banner.imageUrl ? (
            <Image source={{ uri: banner.imageUrl }} style={styles.art} resizeMode="contain" />
          ) : null}
        </View>
      </Gradient>
    </Container>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  card: {
    borderRadius: radius.xl,
    ...shadowLift
  },
  fill: { minHeight: 132 },
  body: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  // The text takes the left two thirds whether or not there is artwork, so a
  // strip of banners with and without images still reads as one carousel.
  text: { flex: 1, gap: 6 },
  title: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  subtitle: { fontSize: 12, lineHeight: 17 },
  cta: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
    borderRadius: radius.sm,
    marginTop: spacing.xs
  },
  ctaText: { fontSize: 12, fontWeight: '700' },
  code: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: spacing.xs
  },
  codeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  art: { width: 96, height: 96 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.border },
  dotOn: { width: 16, backgroundColor: colors.accent }
});
