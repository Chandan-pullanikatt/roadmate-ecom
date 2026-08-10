// Banners and collections (PHASE B) — the merchandising surface.
//
// Ordering has worked end to end since Phase 1. *Promoting* did not exist at
// all: there was no way to put anything in front of a customer beyond the raw
// catalogue, sorted by distance. These are the two things that make a home
// screen a storefront rather than a list.
//
// They are deliberately different shapes, because they are different promises:
//
//   • A BANNER HAS A VALIDITY WINDOW, and that is the point of it being a model.
//     A Diwali strip must switch itself off on its own; anything else means
//     somebody has to remember, and the failure mode is a festival offer still
//     on the home screen in January. `phase` is derived from the clock, exactly
//     as a coupon's and a subscription's are — never stored, because a stored
//     status is a second copy that goes stale the moment a job does not run.
//
//   • A COLLECTION HAS NO MONEY IN IT AT ALL. "Items under ₹99" is a curated,
//     ordered list — it changes what a customer is shown and in what order, and
//     nothing else. No price, no discount, no commission, no settlement. That is
//     why it needs no window and no approval: withdrawing one is a switch.
import prisma from '../lib/prisma.js';
import { isOurAsset } from '../lib/cloudinary.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ---------------------------------------------------------------------------
// BANNERS
// ---------------------------------------------------------------------------

/** Where this banner is in its life. Derived, never stored. */
export function bannerPhase(banner, now = new Date()) {
  if (!banner.isActive) return 'WITHDRAWN';
  if (banner.validFrom > now) return 'SCHEDULED';
  if (banner.validTo < now) return 'EXPIRED';
  return 'LIVE';
}

const bannerRelations = {
  industry: { select: { id: true, name: true } },
  targetShop: { select: { id: true, name: true, businessName: true } },
  targetProduct: { select: { id: true, name: true } },
  targetCoupon: { select: { id: true, code: true, title: true } }
};

/**
 * What a banner points at, as one object rather than four nullable columns.
 * The apps switch on `type` and route on `id`; nothing downstream has to know
 * that the storage is four separate foreign keys.
 */
const targetOf = (b) => {
  if (b.targetShopId) {
    return { type: 'SHOP', id: b.targetShopId, label: b.targetShop?.businessName || b.targetShop?.name };
  }
  if (b.targetProductId) return { type: 'PRODUCT', id: b.targetProductId, label: b.targetProduct?.name };
  if (b.targetCouponId) {
    return { type: 'COUPON', id: b.targetCouponId, label: b.targetCoupon?.code, code: b.targetCoupon?.code };
  }
  // A banner that goes nowhere is legitimate — an announcement, not an advert.
  return { type: 'NONE', id: null, label: null };
};

/**
 * The palettes a banner may be painted in (the storefront pass, 2026-08-10).
 *
 * **A key, never a hex code.** The actual colours live in
 * `packages/ui/src/tokens.js` as `BANNER_THEMES`, which is where every other
 * colour decision on this platform lives and where the "text on this background
 * is ink, never white" rule is already written down. A `#00FF00` in this column
 * would be a banner nobody can restyle, that ignores the design system, and that
 * no accessibility pass can reach.
 *
 * ⚠️ This list and `BANNER_THEMES` are one thing in two files, and the *server*
 * is the one that refuses an unknown key — so a typo fails in front of whoever
 * is making the banner, not as an unstyled grey card on a customer's home
 * screen. `tests/merchandising.test.js` pins the pair.
 */
export const BANNER_THEMES = Object.freeze([
  'sunrise', // warm yellow — the house accent, the default
  'mint',    // fresh green — grocery, produce, "fresh in 20 minutes"
  'sky',     // cool blue — electronics, service, cold chain
  'blush',   // soft pink/red — restaurant, festival, food
  'lilac',   // purple — premium, memberships, ₹9 deals
  'ink'      // near-black — a single high-contrast card for a headline offer
]);

const publicBanner = (b) => ({
  id: b.id,
  title: b.title,
  subtitle: b.subtitle,
  imageUrl: b.imageUrl,
  theme: b.theme,
  ctaLabel: b.ctaLabel,
  validFrom: b.validFrom,
  validTo: b.validTo,
  isActive: b.isActive,
  sortOrder: b.sortOrder,
  industryId: b.industryId,
  industry: b.industry ? { id: b.industry.id, name: b.industry.name } : null,
  target: targetOf(b),
  phase: bannerPhase(b)
});

/**
 * Validate a banner body.
 *
 * The rule worth naming: **at most one target**. Four nullable columns can hold
 * two at once, and a banner that both opens a shop and applies a coupon has no
 * defined behaviour — the app would pick whichever branch it tested first.
 */
async function parseBannerBody(body, { partial = false } = {}) {
  const bad = (message, reason = 'INVALID_BANNER') => ({ ok: false, message, reason });
  const data = {};
  const has = (k) => body?.[k] !== undefined;
  const required = (k) => !partial && !has(k);

  if (required('title')) return bad('A banner needs a title.');
  if (has('title')) {
    const t = String(body.title).trim();
    if (!t) return bad('A banner needs a title.');
    data.title = t;
  }

  if (has('subtitle')) {
    const s = body.subtitle == null ? null : String(body.subtitle).trim();
    data.subtitle = s || null;
  }

  // ⚠️ **The image is no longer the banner, and is no longer required** (the
  // storefront pass, 2026-08-10). It used to be the whole card, which meant no
  // banner could exist until somebody opened a design tool, and that a headline
  // set in a JPEG could not re-wrap on a narrow phone or honour the type scale.
  // The card is composed from `theme` + `title` + `subtitle` + `ctaLabel`, and
  // this is optional artwork on top of it. Blank clears it.
  //
  // Still guarded by `isOurAsset` when present, like every other image write on
  // the platform: a banner must not point at a picture on somebody else's server
  // that changes, 404s, or becomes something the client would not want on a
  // home screen.
  if (has('imageUrl')) {
    const url = String(body.imageUrl ?? '').trim();
    if (!url) data.imageUrl = null;
    else if (!isOurAsset(url, 'BANNER_IMAGE')) {
      return bad('That image was not uploaded to RoadMate. Upload it again.', 'NOT_OUR_ASSET');
    } else data.imageUrl = url;
  }

  // An unknown theme is refused rather than silently defaulted: a typo that
  // renders as the house yellow looks like the banner "just didn't take the
  // colour", which is exactly the kind of failure nobody reports.
  if (has('theme')) {
    const raw = body.theme == null ? '' : String(body.theme).trim().toLowerCase();
    if (!raw) data.theme = null;
    else if (!BANNER_THEMES.includes(raw)) {
      return bad(`Unknown theme. Choose one of: ${BANNER_THEMES.join(', ')}.`, 'UNKNOWN_THEME');
    } else data.theme = raw;
  }

  // Null renders no button — right for an announcement. A CTA is a promise that
  // tapping does something, and `target` is what decides whether it can.
  if (has('ctaLabel')) {
    const label = body.ctaLabel == null ? '' : String(body.ctaLabel).trim();
    if (!label) data.ctaLabel = null;
    else if (label.length > 24) {
      // The button is one line on a 280 dp card. A label that wraps is a card
      // that grows and a carousel whose strips are different heights.
      return bad('A button label must be 24 characters or fewer.', 'CTA_TOO_LONG');
    } else data.ctaLabel = label;
  }

  for (const field of ['validFrom', 'validTo']) {
    if (required(field)) return bad('A banner needs a start and an end date.');
    if (has(field)) {
      const d = new Date(body[field]);
      if (Number.isNaN(d.getTime())) return bad('A banner needs valid start and end dates.');
      data[field] = d;
    }
  }
  if (data.validFrom && data.validTo && data.validFrom >= data.validTo) {
    return bad('A banner must end after it starts.');
  }

  if (has('sortOrder')) {
    const n = Number.parseInt(body.sortOrder, 10);
    if (!Number.isInteger(n)) return bad('Sort order must be a whole number.');
    data.sortOrder = n;
  }

  if (has('isActive')) data.isActive = Boolean(body.isActive);

  if (has('industryId')) {
    if (body.industryId === null || body.industryId === '') data.industryId = null;
    else {
      const id = parseId(body.industryId);
      if (!id) return bad('industryId must be a valid id, or blank.');
      const industry = await prisma.industry.findUnique({ where: { id } });
      if (!industry) return bad('That industry does not exist.', 'BAD_TARGET');
      data.industryId = id;
    }
  }

  // ── The target ──
  const targetFields = ['targetShopId', 'targetProductId', 'targetCouponId'];
  const supplied = targetFields.filter((f) => has(f) && body[f] !== null && body[f] !== '');

  if (supplied.length > 1) {
    return bad('A banner opens one thing. Choose a shop, a product or a coupon.', 'MULTIPLE_TARGETS');
  }

  for (const field of targetFields) {
    if (!has(field)) continue;
    if (body[field] === null || body[field] === '') {
      data[field] = null;
      continue;
    }
    const id = parseId(body[field]);
    if (!id) return bad(`${field} must be a valid id, or blank.`);

    // A real foreign key, checked now. A banner pointing at a product that does
    // not exist should fail here, in front of whoever is making it — not
    // silently on a customer's tap three weeks later.
    const exists =
      field === 'targetShopId'
        ? await prisma.user.findFirst({ where: { id, role: 'SHOP' } })
        : field === 'targetProductId'
          ? await prisma.product.findUnique({ where: { id } })
          : await prisma.coupon.findUnique({ where: { id } });
    if (!exists) return bad('That target does not exist.', 'BAD_TARGET');
    data[field] = id;
  }

  // Setting one target clears the others, so a banner edited from "opens a shop"
  // to "opens a coupon" does not end up holding both.
  if (supplied.length === 1) {
    for (const field of targetFields) {
      if (field !== supplied[0]) data[field] = null;
    }
  }

  return { ok: true, data };
}

/** GET /api/master/banners */
export const listBanners = async (req, res) => {
  try {
    const banners = await prisma.banner.findMany({
      include: bannerRelations,
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }]
    });
    return res.status(200).json({ status: 'success', banners: banners.map(publicBanner) });
  } catch (error) {
    console.error('List Banners Error:', error);
    return res.status(500).json({ message: 'Server error loading banners.' });
  }
};

/** POST /api/master/banners */
export const createBanner = async (req, res) => {
  try {
    const parsed = await parseBannerBody(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });

    const banner = await prisma.banner.create({ data: parsed.data, include: bannerRelations });
    return res.status(201).json({ status: 'success', banner: publicBanner(banner) });
  } catch (error) {
    console.error('Create Banner Error:', error);
    return res.status(500).json({ message: 'Server error creating the banner.' });
  }
};

/** PATCH /api/master/banners/:id */
export const updateBanner = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid banner id.' });

    const existing = await prisma.banner.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Banner not found.' });

    const parsed = await parseBannerBody(req.body, { partial: true });
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    // The window is re-checked against the merged pair, so moving one date
    // cannot land it the wrong side of one that was not touched.
    const from = parsed.data.validFrom ?? existing.validFrom;
    const to = parsed.data.validTo ?? existing.validTo;
    if (from >= to) {
      return res.status(400).json({ message: 'A banner must end after it starts.', reason: 'INVALID_BANNER' });
    }

    const banner = await prisma.banner.update({
      where: { id },
      data: parsed.data,
      include: bannerRelations
    });
    return res.status(200).json({ status: 'success', banner: publicBanner(banner) });
  } catch (error) {
    console.error('Update Banner Error:', error);
    return res.status(500).json({ message: 'Server error updating the banner.' });
  }
};

/**
 * DELETE /api/master/banners/:id
 *
 * A banner is safe to delete outright, unlike a coupon: nothing references it,
 * no order's money depends on it, and an expired one explains nothing about a
 * past transaction. Withdrawing without losing the artwork is still `isActive:
 * false`.
 */
export const deleteBanner = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid banner id.' });

    const existing = await prisma.banner.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Banner not found.' });

    await prisma.banner.delete({ where: { id } });
    return res.status(200).json({ status: 'success', message: 'Banner deleted.' });
  } catch (error) {
    console.error('Delete Banner Error:', error);
    return res.status(500).json({ message: 'Server error deleting the banner.' });
  }
};

/**
 * GET /api/customer/banners?industryId — the home screen's strip.
 *
 * Live only, and the window is applied in the query rather than in JS: this runs
 * on every home-screen load, and a festival banner must stop appearing the
 * moment it expires without anything having to run.
 */
export const listCustomerBanners = async (req, res) => {
  try {
    const industryId = req.query.industryId ? parseId(req.query.industryId) : null;
    const now = new Date();

    const banners = await prisma.banner.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        validTo: { gte: now },
        // Null industry is every home screen; a set one only its own.
        OR: [{ industryId: null }, ...(industryId ? [{ industryId }] : [])]
      },
      include: bannerRelations,
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }]
    });

    return res.status(200).json({
      status: 'success',
      banners: banners.map((b) => ({
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        // Optional artwork over a composed card, not the card itself — see
        // `parseBannerBody`. The app draws a complete banner from the three
        // fields below when this is null.
        imageUrl: b.imageUrl,
        theme: b.theme,
        ctaLabel: b.ctaLabel,
        target: targetOf(b)
      }))
    });
  } catch (error) {
    console.error('List Customer Banners Error:', error);
    return res.status(500).json({ message: 'Server error loading banners.' });
  }
};

// ---------------------------------------------------------------------------
// COLLECTIONS
// ---------------------------------------------------------------------------

const collectionRelations = {
  industry: { select: { id: true, name: true } },
  shop: { select: { id: true, name: true, businessName: true } },
  items: {
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: {
      product: { select: { id: true, name: true, sku: true, image: true, brand: true, price: true } }
    }
  }
};

const publicCollection = (c) => ({
  id: c.id,
  title: c.title,
  subtitle: c.subtitle,
  slug: c.slug,
  isActive: c.isActive,
  sortOrder: c.sortOrder,
  industryId: c.industryId,
  industry: c.industry ? { id: c.industry.id, name: c.industry.name } : null,
  shopId: c.shopId,
  shop: c.shop ? { id: c.shop.id, name: c.shop.businessName || c.shop.name } : null,
  productCount: c.items?.length ?? 0,
  products: (c.items ?? []).map((i) => ({
    id: i.product.id,
    name: i.product.name,
    sku: i.product.sku,
    image: i.product.image,
    brand: i.product.brand,
    price: i.product.price,
    position: i.position
  }))
});

/** "Items under ₹99" → "items-under-99". Unique, so a clash is refused. */
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

async function parseCollectionBody(body, { partial = false } = {}) {
  const bad = (message, reason = 'INVALID_COLLECTION') => ({ ok: false, message, reason });
  const data = {};
  const has = (k) => body?.[k] !== undefined;

  if (!partial && !has('title')) return bad('A collection needs a title.');
  if (has('title')) {
    const t = String(body.title).trim();
    if (!t) return bad('A collection needs a title.');
    data.title = t;
  }

  if (has('subtitle')) {
    const s = body.subtitle == null ? null : String(body.subtitle).trim();
    data.subtitle = s || null;
  }

  // Derived from the title when not given, because nobody should have to think
  // about a slug to make a list of products.
  if (has('slug') && String(body.slug).trim()) data.slug = slugify(body.slug);
  else if (!partial) data.slug = slugify(body.title);
  if (data.slug !== undefined && !data.slug) return bad('That title cannot be turned into a handle. Add some letters or digits.');

  if (has('isActive')) data.isActive = Boolean(body.isActive);

  if (has('sortOrder')) {
    const n = Number.parseInt(body.sortOrder, 10);
    if (!Number.isInteger(n)) return bad('Sort order must be a whole number.');
    data.sortOrder = n;
  }

  for (const [field, check] of [
    ['industryId', (id) => prisma.industry.findUnique({ where: { id } })],
    ['shopId', (id) => prisma.user.findFirst({ where: { id, role: 'SHOP' } })]
  ]) {
    if (!has(field)) continue;
    if (body[field] === null || body[field] === '') {
      data[field] = null;
      continue;
    }
    const id = parseId(body[field]);
    if (!id) return bad(`${field} must be a valid id, or blank.`);
    if (!(await check(id))) return bad('That scope does not exist.', 'BAD_SCOPE');
    data[field] = id;
  }

  return { ok: true, data };
}

/** GET /api/master/collections */
export const listCollections = async (req, res) => {
  try {
    const collections = await prisma.collection.findMany({
      include: collectionRelations,
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }]
    });
    return res.status(200).json({
      status: 'success',
      collections: collections.map(publicCollection)
    });
  } catch (error) {
    console.error('List Collections Error:', error);
    return res.status(500).json({ message: 'Server error loading collections.' });
  }
};

/** POST /api/master/collections */
export const createCollection = async (req, res) => {
  try {
    const parsed = await parseCollectionBody(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });

    const collection = await prisma.collection.create({
      data: parsed.data,
      include: collectionRelations
    });
    return res.status(201).json({ status: 'success', collection: publicCollection(collection) });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        message: 'A collection with that handle already exists.',
        reason: 'SLUG_TAKEN'
      });
    }
    console.error('Create Collection Error:', error);
    return res.status(500).json({ message: 'Server error creating the collection.' });
  }
};

/** PATCH /api/master/collections/:id */
export const updateCollection = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid collection id.' });
    if (!(await prisma.collection.findUnique({ where: { id } }))) {
      return res.status(404).json({ message: 'Collection not found.' });
    }

    const parsed = await parseCollectionBody(req.body, { partial: true });
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    const collection = await prisma.collection.update({
      where: { id },
      data: parsed.data,
      include: collectionRelations
    });
    return res.status(200).json({ status: 'success', collection: publicCollection(collection) });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'A collection with that handle already exists.', reason: 'SLUG_TAKEN' });
    }
    console.error('Update Collection Error:', error);
    return res.status(500).json({ message: 'Server error updating the collection.' });
  }
};

/** DELETE /api/master/collections/:id — items cascade; no money is involved. */
export const deleteCollection = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid collection id.' });
    if (!(await prisma.collection.findUnique({ where: { id } }))) {
      return res.status(404).json({ message: 'Collection not found.' });
    }

    await prisma.collection.delete({ where: { id } });
    return res.status(200).json({ status: 'success', message: 'Collection deleted.' });
  } catch (error) {
    console.error('Delete Collection Error:', error);
    return res.status(500).json({ message: 'Server error deleting the collection.' });
  }
};

/**
 * PUT /api/master/collections/:id/items — set the whole list, in order.
 *
 * A whole-list replace rather than add/remove/reorder verbs, because **order is
 * the content here**. Three separate endpoints would make "move this to the top"
 * a sequence of writes that can half-fail and leave two products claiming
 * position 3. One array, one transaction, positions assigned from the index.
 */
export const setCollectionItems = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid collection id.' });
    if (!(await prisma.collection.findUnique({ where: { id } }))) {
      return res.status(404).json({ message: 'Collection not found.' });
    }

    const raw = req.body?.productIds;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ message: 'productIds must be an array.', reason: 'INVALID_ITEMS' });
    }

    const productIds = [];
    for (const value of raw) {
      const pid = parseId(value);
      if (!pid) return res.status(400).json({ message: 'productIds must all be valid ids.', reason: 'INVALID_ITEMS' });
      // Silently de-duplicating would quietly drop somebody's edit; the unique
      // index refuses it anyway, so say so.
      if (productIds.includes(pid)) {
        return res.status(400).json({
          message: 'A product can only appear in a collection once.',
          reason: 'DUPLICATE_PRODUCT'
        });
      }
      productIds.push(pid);
    }

    if (productIds.length) {
      const found = await prisma.product.count({ where: { id: { in: productIds } } });
      if (found !== productIds.length) {
        return res.status(400).json({ message: 'One of those products does not exist.', reason: 'BAD_PRODUCT' });
      }
    }

    await prisma.$transaction([
      prisma.collectionItem.deleteMany({ where: { collectionId: id } }),
      prisma.collectionItem.createMany({
        data: productIds.map((productId, index) => ({ collectionId: id, productId, position: index }))
      })
    ]);

    const collection = await prisma.collection.findUnique({ where: { id }, include: collectionRelations });
    return res.status(200).json({ status: 'success', collection: publicCollection(collection) });
  } catch (error) {
    console.error('Set Collection Items Error:', error);
    return res.status(500).json({ message: 'Server error updating the collection.' });
  }
};

/**
 * GET /api/customer/collections?industryId&shopId
 *
 * ⚠️ This returns the **curation**, not an offer to sell. A collection is a list
 * of `Product` rows; whether a given shop near this customer has any of them in
 * stock is `ShopInventory`'s question, answered by the browse endpoints that
 * already exist. Merging the two here would mean a collection quietly reordering
 * itself per customer, which is not what "Bestsellers" means — and would put a
 * per-shop stock join on every home-screen load.
 */
export const listCustomerCollections = async (req, res) => {
  try {
    const industryId = req.query.industryId ? parseId(req.query.industryId) : null;
    const shopId = req.query.shopId ? parseId(req.query.shopId) : null;

    const collections = await prisma.collection.findMany({
      where: {
        isActive: true,
        OR: [{ industryId: null }, ...(industryId ? [{ industryId }] : [])],
        AND: [{ OR: [{ shopId: null }, ...(shopId ? [{ shopId }] : [])] }]
      },
      include: collectionRelations,
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }]
    });

    return res.status(200).json({
      status: 'success',
      collections: collections
        // An empty collection is a heading with nothing under it. Hidden here
        // rather than deactivated, because it fills up again the moment
        // somebody adds a product back.
        .filter((c) => c.items.length > 0)
        .map((c) => {
          const view = publicCollection(c);
          return {
            id: view.id,
            title: view.title,
            subtitle: view.subtitle,
            slug: view.slug,
            shopId: view.shopId,
            products: view.products
          };
        })
    });
  } catch (error) {
    console.error('List Customer Collections Error:', error);
    return res.status(500).json({ message: 'Server error loading collections.' });
  }
};
