// Industries and categories — the platform's taxonomy, and the two rails at the
// top of the customer's home screen (2026-08-10, the storefront pass).
//
// ── WHY THIS FILE DID NOT EXIST, AND WHAT THAT COST ────────────────────────────
//
// `Industry.iconUrl` has been in the schema since Phase 0, carrying the comment
// "the tab icons in the Customer design". `Category.iconUrl` has been there just
// as long. **Nothing has ever written to either of them**, because no endpoint
// and no screen could: industries are created by `prisma/seed.js` and categories
// by nobody at all. Two dead columns describing a feature nobody could turn on.
//
// So the customer app rendered the industry rail as seven text chips, which is
// what the client is looking at and asking about. The design (`designs/
// Customer.png`) has artwork above every label and a second row of category
// bubbles under the banner. Neither was buildable.
//
// ── THE ONE RULE WORTH STATING UP FRONT ───────────────────────────────────────
//
// **An icon is optional, and the app is what makes that survivable.** The
// customer app ships its own artwork for every industry and category it knows
// (`apps/consumer/src/art.js`), keyed by slug, and `iconUrl` *overrides* it. So
// the rail looks finished on day one with an empty database, and the client can
// replace any tile from the Master dashboard without a release.
//
// ⚠️ This is NOT the deleted Unsplash backfill coming back (HANDOFF §6). That
// bug took a *product* with no photo and showed a customer a photograph of
// somebody else's product as the item they were buying — a false claim about a
// specific thing for sale. A category tile is the platform's own iconography for
// its own taxonomy: nobody is being told "this is what Grocery looks like at
// this shop", and there is no merchant whose goods are being misrepresented. The
// distinction is whether the picture is a claim about a thing for sale. Here it
// is not.
import prisma from '../lib/prisma.js';
import { isOurAsset } from '../lib/cloudinary.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * An icon URL, or a reason it is refused.
 *
 * Guarded by `isOurAsset` like every other image write on the platform, so the
 * rail cannot end up pointing at a picture on somebody else's server that
 * changes, 404s, or turns into something the client would not want on a home
 * screen. Blank clears the override and falls the tile back to the app's own
 * artwork — which is why clearing is a legitimate edit and not an error.
 */
function parseIconUrl(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  const url = String(raw).trim();
  if (!isOurAsset(url, 'TAXONOMY_ICON')) {
    return {
      ok: false,
      message: 'That image was not uploaded to RoadMate. Upload it again.',
      reason: 'NOT_OUR_ASSET'
    };
  }
  return { ok: true, value: url };
}

// ---------------------------------------------------------------------------
// INDUSTRIES
// ---------------------------------------------------------------------------

const publicIndustry = (i) => ({
  id: i.id,
  name: i.name,
  slug: i.slug,
  fulfilmentType: i.fulfilmentType,
  iconUrl: i.iconUrl,
  isActive: i.isActive,
  sortOrder: i.sortOrder,
  ...(i._count ? { categoryCount: i._count.categories, shopCount: i._count.users } : {})
});

/**
 * The rail's order, everywhere it is read.
 *
 * `sortOrder` then `name`, never `name` alone. A platform that has never
 * touched `sortOrder` has every row at 0 and therefore still sorts by name —
 * which is precisely what `/api/industries` did before the column existed, so
 * nothing changed for anyone who does not use the feature.
 */
export const INDUSTRY_ORDER = [{ sortOrder: 'asc' }, { name: 'asc' }];

/** GET /api/master/industries — the Master taxonomy screen. */
export const listIndustriesForMaster = async (req, res) => {
  try {
    const industries = await prisma.industry.findMany({
      orderBy: INDUSTRY_ORDER,
      include: {
        // Two counts, because the screen's real question is "is this category
        // ready to show a customer" and an industry with no shops is not,
        // however good its icon is.
        _count: { select: { categories: true, users: { where: { role: 'SHOP' } } } }
      }
    });
    return res.status(200).json({ status: 'success', industries: industries.map(publicIndustry) });
  } catch (error) {
    console.error('List Industries Error:', error);
    return res.status(500).json({ message: 'Server error loading industries.' });
  }
};

/**
 * PATCH /api/master/industries/:id — artwork, order, visibility.
 *
 * Deliberately NOT create or delete. An industry is not merchandising: it owns
 * products, shops, orders, coupons and per-industry config rows, and it is the
 * switch `src/lib/fulfilment.js` reads to decide whether an order needs a
 * prescription or is voucher-only. Creating one from a web form would produce a
 * category with no fulfilment branch, no shops and no config, and deleting one
 * would orphan every order ever placed in it. `fulfilmentType` is not editable
 * here for the same reason — flipping a live industry from PICK_AND_DELIVER to
 * NO_DELIVERY would change what a customer is buying mid-flight.
 *
 * What is editable is exactly what is presentational.
 */
export const updateIndustry = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid industry id.' });

    const existing = await prisma.industry.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Industry not found.' });

    const data = {};
    const has = (k) => req.body?.[k] !== undefined;

    if (has('iconUrl')) {
      const parsed = parseIconUrl(req.body.iconUrl);
      if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });
      data.iconUrl = parsed.value;
    }

    if (has('sortOrder')) {
      const n = Number.parseInt(req.body.sortOrder, 10);
      if (!Number.isInteger(n)) return res.status(400).json({ message: 'Sort order must be a whole number.' });
      data.sortOrder = n;
    }

    if (has('isActive')) data.isActive = Boolean(req.body.isActive);

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    const industry = await prisma.industry.update({ where: { id }, data });
    return res.status(200).json({ status: 'success', industry: publicIndustry(industry) });
  } catch (error) {
    console.error('Update Industry Error:', error);
    return res.status(500).json({ message: 'Server error updating the industry.' });
  }
};

/**
 * PUT /api/master/industries/order — the whole rail, in order.
 *
 * The same whole-list-replace shape as `setCollectionItems`, and for the same
 * reason: **order is the content**. "Move Grocery to the front" as a sequence of
 * per-row PATCHes can half-fail and leave two industries claiming position 2,
 * and the customer-facing tie-break (name) would then decide the shop front.
 * One array, one transaction, positions assigned from the index.
 */
export const setIndustryOrder = async (req, res) => {
  try {
    const raw = req.body?.industryIds;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ message: 'industryIds must be an array.', reason: 'INVALID_ORDER' });
    }

    const ids = [];
    for (const value of raw) {
      const id = parseId(value);
      if (!id) return res.status(400).json({ message: 'industryIds must all be valid ids.', reason: 'INVALID_ORDER' });
      if (ids.includes(id)) {
        return res.status(400).json({
          message: 'An industry can only appear once in the order.',
          reason: 'DUPLICATE_INDUSTRY'
        });
      }
      ids.push(id);
    }

    const found = await prisma.industry.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      return res.status(400).json({ message: 'One of those industries does not exist.', reason: 'BAD_INDUSTRY' });
    }

    await prisma.$transaction(
      ids.map((id, index) => prisma.industry.update({ where: { id }, data: { sortOrder: index } }))
    );

    const industries = await prisma.industry.findMany({ orderBy: INDUSTRY_ORDER });
    return res.status(200).json({ status: 'success', industries: industries.map(publicIndustry) });
  } catch (error) {
    console.error('Set Industry Order Error:', error);
    return res.status(500).json({ message: 'Server error reordering industries.' });
  }
};

// ---------------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------------

const publicCategory = (c) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  iconUrl: c.iconUrl,
  sortOrder: c.sortOrder,
  industryId: c.industryId,
  ...(c.industry ? { industry: { id: c.industry.id, name: c.industry.name } } : {}),
  ...(c._count ? { productCount: c._count.products } : {})
});

const CATEGORY_ORDER = [{ sortOrder: 'asc' }, { name: 'asc' }];

/** "Oil & Lubes" → "oil-lubes". Unique per industry, so a clash is refused. */
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

function parseCategoryBody(body, { partial = false } = {}) {
  const bad = (message, reason = 'INVALID_CATEGORY') => ({ ok: false, message, reason });
  const data = {};
  const has = (k) => body?.[k] !== undefined;

  if (!partial && !has('name')) return bad('A category needs a name.');
  if (has('name')) {
    const name = String(body.name).trim();
    if (!name) return bad('A category needs a name.');
    data.name = name;
  }

  if (has('slug') && String(body.slug).trim()) data.slug = slugify(body.slug);
  else if (!partial) data.slug = slugify(body.name);
  if (data.slug !== undefined && !data.slug) {
    return bad('That name cannot be turned into a handle. Add some letters or digits.');
  }

  if (has('iconUrl')) {
    const parsed = parseIconUrl(body.iconUrl);
    if (!parsed.ok) return bad(parsed.message, parsed.reason);
    data.iconUrl = parsed.value;
  }

  if (has('sortOrder')) {
    const n = Number.parseInt(body.sortOrder, 10);
    if (!Number.isInteger(n)) return bad('Sort order must be a whole number.');
    data.sortOrder = n;
  }

  return { ok: true, data };
}

/** GET /api/master/categories?industryId */
export const listCategoriesForMaster = async (req, res) => {
  try {
    const industryId = req.query.industryId ? parseId(req.query.industryId) : null;
    if (req.query.industryId && !industryId) {
      return res.status(400).json({ message: 'Invalid industryId.' });
    }

    const categories = await prisma.category.findMany({
      where: industryId ? { industryId } : {},
      orderBy: [{ industryId: 'asc' }, ...CATEGORY_ORDER],
      include: {
        industry: { select: { id: true, name: true } },
        _count: { select: { products: true } }
      }
    });
    return res.status(200).json({ status: 'success', categories: categories.map(publicCategory) });
  } catch (error) {
    console.error('List Categories Error:', error);
    return res.status(500).json({ message: 'Server error loading categories.' });
  }
};

/** POST /api/master/categories */
export const createCategory = async (req, res) => {
  try {
    const industryId = parseId(req.body?.industryId);
    if (!industryId) return res.status(400).json({ message: 'A category belongs to an industry.' });
    if (!(await prisma.industry.findUnique({ where: { id: industryId } }))) {
      return res.status(400).json({ message: 'That industry does not exist.', reason: 'BAD_INDUSTRY' });
    }

    const parsed = parseCategoryBody(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });

    const category = await prisma.category.create({
      data: { ...parsed.data, industryId },
      include: { industry: { select: { id: true, name: true } } }
    });
    return res.status(201).json({ status: 'success', category: publicCategory(category) });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        message: 'That industry already has a category with this handle.',
        reason: 'SLUG_TAKEN'
      });
    }
    console.error('Create Category Error:', error);
    return res.status(500).json({ message: 'Server error creating the category.' });
  }
};

/**
 * PATCH /api/master/categories/:id
 *
 * `industryId` is deliberately not editable. A category's products carry both a
 * `categoryId` and an `industryId` of their own, and moving the category would
 * leave every product in it filed under an industry its category no longer
 * belongs to — a silent split that the browse endpoints would render as an
 * empty category next to products nobody can find.
 */
export const updateCategory = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid category id.' });
    if (!(await prisma.category.findUnique({ where: { id } }))) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    const parsed = parseCategoryBody(req.body, { partial: true });
    if (!parsed.ok) return res.status(400).json({ message: parsed.message, reason: parsed.reason });
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    const category = await prisma.category.update({
      where: { id },
      data: parsed.data,
      include: { industry: { select: { id: true, name: true } } }
    });
    return res.status(200).json({ status: 'success', category: publicCategory(category) });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'That industry already has a category with this handle.', reason: 'SLUG_TAKEN' });
    }
    console.error('Update Category Error:', error);
    return res.status(500).json({ message: 'Server error updating the category.' });
  }
};

/**
 * DELETE /api/master/categories/:id
 *
 * ⚠️ **Refused while products are filed under it** (409 `CATEGORY_IN_USE`), the
 * same rule a used coupon gets. `Product.categoryId` is nullable, so Postgres
 * would happily let this through and quietly null out the category on every
 * product in it — which is not a deletion anybody asked for, and is unrecoverable
 * without a backup. Emptying the category first is a decision a human should make
 * product by product.
 */
export const deleteCategory = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid category id.' });
    if (!(await prisma.category.findUnique({ where: { id } }))) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    const products = await prisma.product.count({ where: { categoryId: id } });
    if (products > 0) {
      return res.status(409).json({
        message: `${products} product${products === 1 ? '' : 's'} are filed under this category. Move them first.`,
        reason: 'CATEGORY_IN_USE',
        productCount: products
      });
    }

    await prisma.category.delete({ where: { id } });
    return res.status(200).json({ status: 'success', message: 'Category deleted.' });
  } catch (error) {
    console.error('Delete Category Error:', error);
    return res.status(500).json({ message: 'Server error deleting the category.' });
  }
};

/**
 * GET /api/customer/categories?industryId — the design's "Product Category" row.
 *
 * Two things it deliberately does not do:
 *
 *   • **It does not filter by what is in stock near this customer.** A category
 *     is the industry's shape, not this address's inventory — a row that
 *     reshuffled itself per postcode is not a navigation anybody can learn, and
 *     it would put a per-shop stock join on every home-screen load. Same call
 *     `listCustomerCollections` makes, and for the same reason.
 *   • **It does not invent an "All" entry.** The app draws that, because "All"
 *     is the absence of a filter rather than a category — a row in this response
 *     would need a fake id that every consumer of the endpoint has to know to
 *     skip.
 */
export const listCustomerCategories = async (req, res) => {
  try {
    const industryId = req.query.industryId ? parseId(req.query.industryId) : null;
    if (req.query.industryId && !industryId) {
      return res.status(400).json({ message: 'Invalid industryId.' });
    }

    const categories = await prisma.category.findMany({
      where: industryId ? { industryId } : {},
      orderBy: CATEGORY_ORDER,
      take: 30
    });

    return res.status(200).json({
      status: 'success',
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        iconUrl: c.iconUrl,
        industryId: c.industryId
      }))
    });
  } catch (error) {
    console.error('List Customer Categories Error:', error);
    return res.status(500).json({ message: 'Server error loading categories.' });
  }
};
