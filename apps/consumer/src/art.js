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
// ── WHY GLYPHS AND NOT BUNDLED IMAGES ─────────────────────────────────────────
//
// A colour emoji is a real, full-colour, vector, system-rendered image at every
// density, on both platforms, at zero bytes of bundle and zero network. Seven
// PNGs would be ~1 MB in six builds, wrong on one platform's density buckets,
// and still just placeholders. The tile — its tint, radius, shadow and selected
// state — is what carries the design here, and it is the same frame a real
// uploaded photograph drops into.

import { tileTint } from '@roadmate/ui';

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
  automobile:  { glyph: '🛺', short: 'Automobile' },
  groceries:   { glyph: '🛒', short: 'Grocery' },
  grocery:     { glyph: '🛒', short: 'Grocery' },
  restaurant:  { glyph: '🍔', short: 'Restaurant' },
  food:        { glyph: '🍔', short: 'Food' },
  electronics: { glyph: '📱', short: 'Electronics' },
  textiles:    { glyph: '👗', short: 'Fashion' },
  fashion:     { glyph: '👗', short: 'Fashion' },
  apparel:     { glyph: '👗', short: 'Fashion' },
  pharmacy:    { glyph: '💊', short: 'Pharmacy' },
  medicine:    { glyph: '💊', short: 'Pharmacy' },
  sports:      { glyph: '🏏', short: 'Sports' },
  gym:         { glyph: '🏋️', short: 'Gym' },
  fitness:     { glyph: '🏋️', short: 'Gym' }
};

/**
 * By category slug. Matched loosely — see `artFor` — because a category is
 * created by a human typing a name, and "Fruits & Vegetables", "Fresh Veggies"
 * and "Vegetables" should not need three entries to get a carrot.
 */
const CATEGORY_ART = {
  // automobile
  'oil': '🛢️', 'lube': '🛢️', 'engine': '🛢️',
  'care': '🧽', 'wash': '🧽', 'polish': '🧽',
  'spare': '🔧', 'fitment': '🔧', 'part': '🔧', 'brake': '🔧',
  'tyre': '🛞', 'wheel': '🛞',
  'accessor': '🔦', 'light': '🔦', 'lamp': '🔦',

  // grocery
  'fruit': '🍎', 'vegetable': '🥦', 'veggie': '🥦', 'fresh': '🥬',
  'dairy': '🥛', 'milk': '🥛', 'bakery': '🥐', 'bread': '🥐',
  'snack': '🍿', 'chips': '🍿', 'chocolate': '🍫',
  'staple': '🌾', 'rice': '🌾', 'grain': '🌾', 'atta': '🌾',
  'beverage': '🥤', 'drink': '🥤', 'tea': '🍵', 'coffee': '☕',

  // restaurant
  'biryani': '🍛', 'rice bowl': '🍛', 'curry': '🍛',
  'burger': '🍔', 'pizza': '🍕', 'sandwich': '🥪',
  'dessert': '🍰', 'sweet': '🍰', 'cake': '🍰', 'ice': '🍨',
  'veg': '🥗', 'salad': '🥗', 'chicken': '🍗', 'seafood': '🦐', 'fish': '🐟',

  // electronics
  'phone': '📱', 'mobile': '📱', 'smartphone': '📱',
  'laptop': '💻', 'computer': '💻', 'tablet': '📱',
  'earbud': '🎧', 'headset': '🎧', 'headphone': '🎧', 'audio': '🔊',
  'power': '🔋', 'battery': '🔋', 'charger': '🔌',
  'appliance': '🍳', 'kitchen': '🍳', 'tv': '📺', 'camera': '📷', 'watch': '⌚',

  // fashion
  'men': '👔', 'women': '👗', 'kid': '🧸', 'child': '🧸', 'baby': '🍼',
  'footwear': '👟', 'shoe': '👟', 'sandal': '🩴',
  'bag': '👜', 'jewel': '💍', 'beauty': '💄', 'cosmetic': '💄',
  'saree': '🥻', 'ethnic': '🥻',

  // sports / gym
  'fitness': '🏋️', 'gym': '🏋️', 'yoga': '🧘',
  'cricket': '🏏', 'football': '⚽', 'badminton': '🏸', 'basketball': '🏀',
  'cycl': '🚲', 'bike': '🚲', 'run': '🏃',
  'nutrition': '🥤', 'protein': '🥤', 'supplement': '💊',

  // pharmacy
  'medicine': '💊', 'pharma': '💊', 'wellness': '🩺', 'device': '🩺'
};

const FALLBACK_GLYPH = '🛍️';

/**
 * What to draw for one taxonomy row.
 *
 * @param {{slug?: string, name?: string, iconUrl?: string|null}} row
 * @param {number} index position in the rail — only used for the tint
 * @param {'industry'|'category'} kind
 * @returns {{imageUrl: string|null, glyph: string, label: string, tint: string}}
 *   `imageUrl` non-null means the tile draws the real photograph and ignores the
 *   glyph entirely.
 */
export function artFor(row, index = 0, kind = 'industry') {
  const slug = String(row?.slug ?? '').toLowerCase();
  const name = String(row?.name ?? '');
  const tint = tileTint(index);

  // The uploaded image always wins. Nothing below runs when there is one.
  if (row?.iconUrl) {
    return { imageUrl: row.iconUrl, glyph: null, label: shortLabel(row, kind), tint };
  }

  if (kind === 'industry') {
    const art = INDUSTRY_ART[slug];
    return { imageUrl: null, glyph: art?.glyph ?? FALLBACK_GLYPH, label: shortLabel(row, kind), tint };
  }

  // Categories are matched on substrings of both the slug and the name, longest
  // key first so "oil" cannot win over a hypothetical "oil filter". A human
  // typed this name; an exact-match table would miss almost every real one.
  const haystack = `${slug} ${name}`.toLowerCase();
  const key = Object.keys(CATEGORY_ART)
    .sort((a, b) => b.length - a.length)
    .find((k) => haystack.includes(k));

  return { imageUrl: null, glyph: key ? CATEGORY_ART[key] : FALLBACK_GLYPH, label: name, tint };
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

/** The logo, as one import so no screen hardcodes the path. */
export const LOGO = require('../assets/roadmate-logo.jpeg');
