// The photograph behind each demo banner, pinned.
//
// The third sibling of `productPhotos.js` and `shopPhotos.js`.
//
// ── WHY A BANNER PHOTO IS A DIFFERENT ARGUMENT ────────────────────────────────
//
// `Banner.imageUrl` is **optional by design**, and that was the right call: the
// 2026-08-10 pass turned a banner from "a flat JPEG somebody has to design" into
// a composed card — theme, real text, real CTA — precisely so the storefront
// could be finished without an art department. `PromoCarousel.js` explains why at
// length, and none of it is undone here. A headline still re-wraps, still obeys
// the type scale, still reads to a screen reader.
//
// What a photograph adds is the thing a flat pastel card cannot fake: **it looks
// like a shop that sells something.** So the photo is a *backdrop* the text sits
// on, never the text itself. Delete every row here and the strip still works.
//
// ── HOW THE PICTURE IS CHOSEN ─────────────────────────────────────────────────
//
// By the offer, not by the industry: "Gear up for the season" gets an athlete on
// the blocks, not a shelf of dumbbells. A banner is mood — the card already says
// what the deal is in words directly beside it, so the picture's whole job is to
// make somebody want to read them.
//
// ⚠️ Two of these were rejected after being rendered and looked at, which is the
// only reason to keep doing that: the automobile pool's best-ranked CC0 result
// was a woman in a bikini washing a car, and the second was a 1970s drag-racing
// archive. Neither is anywhere near a client demo. Keyword search cannot tell you
// this; a contact sheet can.
//
// ⚠️ Placeholders, like the other two files. Real promotional artwork comes from
// whoever runs the campaign, through the Master dashboard, which is also where
// the CC BY-SA credits below stop mattering.

/**
 * @typedef {object} BannerPhoto
 * @property {string} banner Matches `Banner.title` exactly — the key the seed
 *   already uses for banners, because a banner has no natural unique id.
 * @property {string} slug Stable Cloudinary id, so a re-run overwrites its own
 *   asset instead of adding another.
 * @property {string} source Where the picture is fetched from, once.
 * @property {string} credit Attribution, for the licences that require it.
 * @property {string} license The licence the source is offered under.
 */

/** @type {BannerPhoto[]} */
export const BANNER_PHOTOS = [
  {
    banner: 'Get 20% OFF on Auto Essentials',
    slug: 'banner-automobile',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Mobile_Wash_partner_washing_a_car.jpg/1280px-Mobile_Wash_partner_washing_a_car.jpg',
    credit: 'Juanacosta84',
    license: 'CC BY-SA 4.0'
  },
  {
    banner: 'Get items for just ₹9',
    slug: 'banner-groceries',
    source: 'https://live.staticflickr.com/837/42805184804_8f2abed875_b.jpg',
    credit: 'Artem Beliaikin',
    license: 'cc0-1.0'
  },
  {
    banner: 'Get 20% OFF at Paragon',
    slug: 'banner-restaurant',
    source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Arabian_Camel_Meat_Biryani.JPG/1280px-Arabian_Camel_Meat_Biryani.JPG',
    credit: 'Miansari66',
    license: 'cc0-1.0'
  },
  {
    banner: 'Get 20% OFF on Electronics',
    slug: 'banner-electronics',
    source: 'https://cdn.stocksnap.io/img-thumbs/960w/8OTKBEWXCP.jpg',
    credit: 'Wilfred Iven',
    license: 'cc0-1.0'
  },
  {
    banner: 'Buy one jacket, get the second at 50% off',
    slug: 'banner-textiles',
    source: 'https://live.staticflickr.com/65535/48124880907_71f5366253_b.jpg',
    credit: 'Artem Beliaikin',
    license: 'cc0-1.0'
  },
  {
    banner: 'Gear up for the season',
    slug: 'banner-sports',
    source: 'https://cdn.stocksnap.io/img-thumbs/960w/EG7KI8FXPR.jpg',
    credit: 'William Stitt',
    license: 'cc0-1.0'
  },
  {
    banner: 'Free delivery above ₹199',
    slug: 'banner-delivery',
    source: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Piaggio_Mymoover_125.jpg',
    credit: 'Laura Buononome',
    license: 'CC BY-SA 2.0'
  },
];
