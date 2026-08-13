// The artwork the storefront falls back to, keyed by slug.
//
// ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────────
//
// `Industry.iconUrl` and `Category.iconUrl` have been in the schema since Phase 0
// and nothing had ever written to either (see `server/src/controllers/
// taxonomyController.js`). The rail therefore rendered as seven text chips —
// which is what the client is looking at — while the design has artwork above
// every label.
//
// The obvious fix is "make the client upload seven icons". That is a fix that
// ships in three weeks, blocks the demo, and leaves the rail broken for any
// industry added later before somebody remembers the artwork.
//
// ── THE RULE ──────────────────────────────────────────────────────────────────
//
// **The app ships artwork for the taxonomy it knows; `iconUrl` overrides it.**
// So the rail is finished on day one against an empty database, and the client
// can replace any single tile from the Master dashboard without a release. The
// two are not alternatives — the uploaded image always wins, and the fallback is
// what stands in until (and if) there is one.
//
// ⚠️ **This is not the deleted Unsplash backfill** (HANDOFF §6, "must not come
// back"). That bug took a *product* with no photo and rendered a photograph of
// somebody else's product as the item the customer was buying — a false claim
// about a specific thing for sale, made silently. Nothing here is a claim about
// merchandise: a glyph on a tinted tile is the platform's own iconography for
// its own categories, and no merchant's goods are being depicted. The line is
// whether the picture asserts something about a thing you can put in a basket.
// A category tile does not.
//
// ── WHY VECTOR ICONS AND NOT EMOJI (changed 2026-08-13) ───────────────────────
//
// This table held **colour emoji** until the client demo pass, on the reasoning
// that an emoji is a free, full-colour, system-rendered image at every density.
// All of that is true and it was still the wrong call, for the reason `Icon.js`
// already records about the tab bars it replaced:
//
//   • **An emoji is whatever the handset decided it looks like.** 🛺 is a Google
//     auto-rickshaw on a Pixel, a different drawing on a Samsung, and on a
//     device whose font pack is short it is a **tofu box**. The storefront's top
//     row is the first thing the customer sees, and "which phone is this" is not
//     an acceptable input to it.
//   • **Emoji do not share a design.** 🛒 is flat, 💊 has a gradient, 🏋️ has a
//     skin tone and a ZWJ sequence in it. Seven of them in a row read as seven
//     stickers from seven sources — which is exactly the "prototype" tell the
//     client is looking at.
//   • **They ignore the palette.** A colour emoji brings its own colours, so the
//     tile's tint is decoration behind an unrelated picture rather than the
//     frame around a related one.
//
// Ionicons fixes all three: one family, one weight, and it takes its colour from
// us — `tileArt()` pairs each tint with the saturated dark member of its own hue,
// so the row is seven *related* tiles instead of seven stickers. It costs no new
// native module (`@expo/vector-icons` is JS + a bundled TTF over `expo-font`,
// which every dev client already has — see `packages/ui/src/Icon.js`) and no
// bundled PNGs.
//
// ⚠️ **Names below are raw Ionicons names, and that is deliberate — see the note
// on `VectorIcon`.** They are not `ICONS` concepts and must not be moved there:
// `ICONS` is the twenty-odd things the *product* means (Orders, Cart, Profile)
// across six apps, and burying those under sixty category pictures is how that
// table stops being useful.

import { tileArt } from '@roadmate/ui';

/**
 * By industry slug — `prisma/seed.js`'s slugs, not the design's labels.
 *
 * `short` exists because "Electronics and Home Appliances" is a real industry
 * name that is four words too long for a 72 dp tile. Renaming the row to fit a
 * tile would be a cosmetic edit to data seven dashboards and every partner
 * filed under it depend on — so the display label lives here and the name stays
 * where it is.
 */
const INDUSTRY_ART = {
  automobile:  { icon: 'car-sport',      short: 'Automobile' },
  groceries:   { icon: 'basket',         short: 'Grocery' },
  grocery:     { icon: 'basket',         short: 'Grocery' },
  restaurant:  { icon: 'restaurant',     short: 'Restaurant' },
  food:        { icon: 'fast-food',      short: 'Food' },
  electronics: { icon: 'phone-portrait', short: 'Electronics' },
  textiles:    { icon: 'shirt',          short: 'Fashion' },
  fashion:     { icon: 'shirt',          short: 'Fashion' },
  apparel:     { icon: 'shirt',          short: 'Fashion' },
  pharmacy:    { icon: 'medkit',         short: 'Pharmacy' },
  medicine:    { icon: 'medkit',         short: 'Pharmacy' },
  sports:      { icon: 'basketball',     short: 'Sports' },
  gym:         { icon: 'barbell',        short: 'Gym' },
  fitness:     { icon: 'barbell',        short: 'Gym' }
};

/**
 * By category slug. Matched loosely — see `artFor` — because a category is
 * created by a human typing a name, and "Fruits & Vegetables", "Fresh Veggies"
 * and "Vegetables" should not need three entries to get a carrot.
 */
const CATEGORY_ART = {
  // automobile
  'oil': 'water', 'lube': 'water', 'engine': 'water',
  'care': 'sparkles', 'wash': 'sparkles', 'polish': 'sparkles',
  'spare': 'construct', 'fitment': 'construct', 'part': 'construct', 'brake': 'construct',
  'tyre': 'disc', 'wheel': 'disc',
  'accessor': 'flashlight', 'light': 'flashlight', 'lamp': 'flashlight',

  // grocery
  'fruit': 'nutrition', 'vegetable': 'leaf', 'veggie': 'leaf', 'fresh': 'leaf',
  'dairy': 'pint', 'milk': 'pint', 'bakery': 'cafe', 'bread': 'cafe',
  'snack': 'fast-food', 'chips': 'fast-food', 'chocolate': 'ice-cream',
  'staple': 'basket', 'rice': 'basket', 'grain': 'basket', 'atta': 'basket',
  'beverage': 'cafe', 'drink': 'cafe', 'tea': 'cafe', 'coffee': 'cafe',

  // restaurant
  'biryani': 'restaurant', 'rice bowl': 'restaurant', 'curry': 'restaurant',
  'burger': 'fast-food', 'pizza': 'pizza', 'sandwich': 'fast-food',
  'dessert': 'ice-cream', 'sweet': 'ice-cream', 'cake': 'ice-cream', 'ice': 'ice-cream',
  'veg': 'leaf', 'salad': 'leaf', 'chicken': 'fast-food', 'seafood': 'fish', 'fish': 'fish',

  // electronics
  'phone': 'phone-portrait', 'mobile': 'phone-portrait', 'smartphone': 'phone-portrait',
  'laptop': 'laptop', 'computer': 'laptop', 'tablet': 'tablet-portrait',
  'earbud': 'headset', 'headset': 'headset', 'headphone': 'headset', 'audio': 'headset',
  'power': 'battery-full', 'battery': 'battery-full', 'charger': 'flash',
  'appliance': 'restaurant', 'kitchen': 'restaurant', 'tv': 'tv', 'camera': 'camera', 'watch': 'watch',

  // fashion
  'men': 'shirt', 'women': 'woman', 'kid': 'happy', 'child': 'happy', 'baby': 'happy',
  'footwear': 'walk', 'shoe': 'walk', 'sandal': 'walk',
  'bag': 'bag-handle', 'jewel': 'diamond', 'beauty': 'brush', 'cosmetic': 'brush',
  'saree': 'woman', 'ethnic': 'woman',

  // sports / gym
  'fitness': 'barbell', 'gym': 'barbell', 'yoga': 'body',
  'cricket': 'baseball', 'football': 'football', 'badminton': 'tennisball', 'basketball': 'basketball',
  'cycl': 'bicycle', 'bike': 'bicycle', 'run': 'walk',
  'nutrition': 'flask', 'protein': 'flask', 'supplement': 'flask',

  // pharmacy
  'medicine': 'medkit', 'pharma': 'medkit', 'wellness': 'pulse', 'device': 'thermometer'
};

const FALLBACK_ICON = 'bag-handle';

/**
 * What to draw for one taxonomy row.
 *
 * @param {{slug?: string, name?: string, iconUrl?: string|null}} row
 * @param {number} index position in the rail — only used for the tint
 * @param {'industry'|'category'} kind
 * @returns {{imageUrl: string|null, icon: string, label: string, tint: string, ink: string}}
 *   `imageUrl` non-null means the tile draws the real photograph and ignores the
 *   icon entirely. `tint` and `ink` always arrive together — the ink is only
 *   legible against its own tint (`tileArt` in `packages/ui/src/tokens.js`).
 */
export function artFor(row, index = 0, kind = 'industry') {
  const slug = String(row?.slug ?? '').toLowerCase();
  const name = String(row?.name ?? '');
  const { tint, ink } = tileArt(index);

  // The uploaded image always wins. Nothing below runs when there is one.
  if (row?.iconUrl) {
    return { imageUrl: row.iconUrl, icon: null, label: shortLabel(row, kind), tint, ink };
  }

  if (kind === 'industry') {
    const art = INDUSTRY_ART[slug];
    return { imageUrl: null, icon: art?.icon ?? FALLBACK_ICON, label: shortLabel(row, kind), tint, ink };
  }

  // Categories are matched on substrings of both the slug and the name, longest
  // key first so "oil" cannot win over a hypothetical "oil filter". A human
  // typed this name; an exact-match table would miss almost every real one.
  const haystack = `${slug} ${name}`.toLowerCase();
  const key = Object.keys(CATEGORY_ART)
    .sort((a, b) => b.length - a.length)
    .find((k) => haystack.includes(k));

  return { imageUrl: null, icon: key ? CATEGORY_ART[key] : FALLBACK_ICON, label: name, tint, ink };
}

/**
 * The label under a tile. Industries get their short form when we have one;
 * everything else gets its name, and the tile clips to two lines rather than
 * this guessing where to cut a word.
 */
export function shortLabel(row, kind = 'industry') {
  if (kind === 'industry') {
    const art = INDUSTRY_ART[String(row?.slug ?? '').toLowerCase()];
    if (art?.short) return art.short;
  }
  return row?.name ?? '';
}

/**
 * The decorative icon on a promotional banner, by theme (2026-08-13).
 *
 * A banner is a composed card — theme, headline, sub, button — and its right
 * third was **empty** whenever nobody had uploaded artwork, which is every
 * banner the demo seed creates. An empty third does not read as minimal; it
 * reads as an image that failed to load.
 *
 * ⚠️ **Keyed by theme, not by industry or by title.** The theme is the only
 * field a banner is guaranteed to have and the only one the server validates, so
 * this cannot miss — and a banner the client writes tomorrow from the Master
 * dashboard gets composed artwork without anybody adding a row here. It is
 * decoration in the card's own ink at low opacity, never a claim about
 * merchandise, and `imageUrl` still beats it (see `PromoCarousel`).
 */
const BANNER_ART = {
  sunrise: 'sunny',
  mint: 'leaf',
  sky: 'car-sport',
  blush: 'restaurant',
  lilac: 'sparkles',
  ink: 'pricetag'
};

const FALLBACK_BANNER_ICON = 'pricetag';

/** @returns {string} an Ionicons name — always one, never null. */
export const bannerArt = (theme) => BANNER_ART[theme] ?? FALLBACK_BANNER_ICON;

/** The logo, as one import so no screen hardcodes the path. */
export const LOGO = require('../assets/roadmate-logo.jpeg');
