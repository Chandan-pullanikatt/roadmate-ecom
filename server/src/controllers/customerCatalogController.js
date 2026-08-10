// Phase 1.2/1.3 — what a customer at a point can see: serviceability, shops,
// and the catalog, browsed either way (hybrid browse is decided, not optional —
// HANDOFF §3).
//
// All the routing intelligence lives in `lib/shopRanking.js`; these handlers
// only parse input and shape the response.
import prisma from '../lib/prisma.js';
import { parseLatLng } from '../lib/geo.js';
import { rankCandidateShops, filterDeliverableShops, publicShop } from '../lib/shopRanking.js';
import { sellableQty } from '../lib/inventory.js';
import { etaMinutesForShops } from '../lib/eta.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';

const MAX_PAGE_SIZE = 50;

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const parseLimit = (raw, fallback = 20) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, MAX_PAGE_SIZE);
};

/** Decimal → a fixed-2 string. Never let a Prisma Decimal reach JSON raw. */
const money = (d) => (d == null ? null : Number(d).toFixed(2));

/**
 * GET /api/customer/serviceable?lat&lng&industryId
 *
 * Two independent conditions, reported separately so the app can say *why*:
 * a shop in range, and a rider on shift who could collect from it.
 */
export const getServiceable = async (req, res) => {
  try {
    const point = parseLatLng(req.query.lat, req.query.lng);
    if (!point) {
      return res.status(400).json({ message: 'Please provide a valid lat and lng.' });
    }

    const industryId = req.query.industryId ? parseId(req.query.industryId) : null;
    if (req.query.industryId && !industryId) {
      return res.status(400).json({ message: 'Invalid industryId.' });
    }

    const ranked = await rankCandidateShops(point.lat, point.lng, industryId, {
      limit: parseLimit(req.query.limit)
    });

    // Two kinds of rider now (HANDOFF §3). A shop on the platform pool needs a
    // RoadMate rider near the customer; a shop using its own delivery boys needs
    // one of those on shift instead. `deliverable` is the intersection of "in
    // range" and "somebody can collect from it".
    const { deliverable: shops, platformCovered } = await filterDeliverableShops(ranked, {
      lat: point.lat,
      lng: point.lng,
      industryId
    });

    // No shop in range at all is NO_SHOP. Shops in range that nobody can collect
    // from is NO_RIDER — which is now also what a self-delivering shop with all
    // its boys off shift looks like, and saying so is more useful than "closed".
    if (!shops.length && (ranked.length || !platformCovered)) {
      return res.status(200).json({
        status: 'success',
        serviceable: false,
        reason: 'NO_RIDER',
        message: 'No delivery partner is on shift in your area right now.',
        shops: []
      });
    }

    if (!shops.length) {
      return res.status(200).json({
        status: 'success',
        serviceable: false,
        reason: 'NO_SHOP',
        message: 'No open shop delivers to this location yet.',
        shops: []
      });
    }

    // The two things the design's shop card says that the raw row does not (the
    // storefront pass, 2026-08-10): how long it will take, and whether delivery
    // is free.
    //
    // Both are computed **here** rather than in the app. The ETA is the same
    // formula placement uses, so the card and the confirmation cannot disagree;
    // the free-delivery line is a `PlatformConfig` row the client can move from
    // the Master screen at any moment, and a threshold hardcoded in six app
    // builds is a promise that keeps being made after the platform stopped
    // honouring it.
    const industry = industryId
      ? await prisma.industry.findUnique({ where: { id: industryId }, select: { fulfilmentType: true } })
      : null;

    const [etas, freeDeliveryAbove] = await Promise.all([
      etaMinutesForShops(shops, {
        fulfilmentType: industry?.fulfilmentType,
        dropLat: point.lat,
        dropLng: point.lng,
        industryId
      }),
      getConfigNumber(CONFIG_KEYS.FREE_DELIVERY_THRESHOLD, industryId)
    ]);

    return res.status(200).json({
      status: 'success',
      serviceable: true,
      // A threshold of 0 means the client has not set one, and the app must not
      // render "free delivery above ₹0" — which reads as "delivery is free",
      // a claim nobody made. Null is the honest answer, and the same
      // unset-is-not-zero rule the config screen already holds.
      freeDeliveryAbove: freeDeliveryAbove > 0 ? Number(freeDeliveryAbove).toFixed(2) : null,
      shops: shops.map((shop) => publicShop(shop, { etaMin: etas.get(shop.id) ?? null }))
    });
  } catch (error) {
    console.error('Serviceable Error:', error);
    return res.status(500).json({ message: 'Server error while checking serviceability.' });
  }
};

/**
 * GET /api/customer/shops/:shopId/products?categoryId&q
 *
 * Browse-by-shop. Only rows the shop can actually sell appear — the customer
 * never sees raw `quantity`.
 */
export const getShopProducts = async (req, res) => {
  try {
    const shopId = parseId(req.params.shopId);
    if (!shopId) return res.status(400).json({ message: 'Invalid shop id.' });

    const shop = await prisma.user.findFirst({
      where: { id: shopId, role: 'SHOP', isActive: true }
    });
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });

    const categoryId = req.query.categoryId ? parseId(req.query.categoryId) : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const rows = await prisma.shopInventory.findMany({
      where: {
        shopId,
        isAvailable: true,
        product: {
          ...(categoryId ? { categoryId } : {}),
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {})
        }
      },
      include: { product: { include: { category: true, addOns: true } }, variant: true },
      orderBy: { id: 'asc' },
      take: parseLimit(req.query.limit, MAX_PAGE_SIZE)
    });

    // ⚠️ Sold out is a **state**, not an absence (HANDOFF §7.6, promised to
    // customers 2026-08-08). A shelf row with nothing sellable on it used to be
    // dropped here, which reads as "this shop does not stock it" — a different
    // and worse claim than "they have it, they are out". So every available row
    // is returned with `inStock`, and the sold-out ones sink to the bottom of
    // the list rather than vanishing from it.
    //
    // What stays absent: a SKU the shop has switched off, and one auto-hidden by
    // three consecutive stockouts. Those are `isAvailable: false` and filtered
    // in the query above — the shop is not vouching for that count at all, so
    // "sold out" would be a claim nobody has made.
    const items = rows.map((row) => shelfItem(row, shop));
    items.sort((a, b) => Number(b.inStock) - Number(a.inStock));

    return res.status(200).json({
      status: 'success',
      shop: { ...publicShop(shop), isOpen: shop.isOpen },
      count: items.length,
      // The two numbers the shelf is really about, so the app never has to
      // derive "everything here is sold out" by scanning the list itself.
      inStockCount: items.filter((i) => i.inStock).length,
      items
    });
  } catch (error) {
    console.error('Shop Products Error:', error);
    return res.status(500).json({ message: 'Server error while loading the shop catalog.' });
  }
};

/**
 * GET /api/customer/products?lat&lng&industryId&q&categoryId
 *
 * Browse-by-product. Same product across every serviceable shop, cheapest
 * offer first — the other half of the hybrid browse.
 */
export const searchProducts = async (req, res) => {
  try {
    const point = parseLatLng(req.query.lat, req.query.lng);
    if (!point) {
      return res.status(400).json({ message: 'Please provide a valid lat and lng.' });
    }

    const industryId = req.query.industryId ? parseId(req.query.industryId) : null;
    if (req.query.industryId && !industryId) {
      return res.status(400).json({ message: 'Invalid industryId.' });
    }

    const shops = await rankCandidateShops(point.lat, point.lng, industryId);
    if (!shops.length) {
      return res.status(200).json({ status: 'success', count: 0, products: [] });
    }

    const byShopId = new Map(shops.map((s) => [s.id, s]));
    const categoryId = req.query.categoryId ? parseId(req.query.categoryId) : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const rows = await prisma.shopInventory.findMany({
      where: {
        shopId: { in: [...byShopId.keys()] },
        isAvailable: true,
        product: {
          ...(categoryId ? { categoryId } : {}),
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {})
        }
      },
      include: { product: { include: { category: true } }, variant: true }
    });

    // Group by product: one card per product, with the shops that have it.
    const products = new Map();
    for (const row of rows) {
      const shop = byShopId.get(row.shopId);
      const item = shelfItem(row, shop);

      if (!products.has(row.productId)) {
        products.set(row.productId, {
          id: row.product.id,
          name: row.product.name,
          sku: row.product.sku,
          brand: row.product.brand,
          image: row.product.image,
          isVeg: row.product.isVeg,
          category: row.product.category
            ? { id: row.product.category.id, name: row.product.category.name }
            : null,
          offers: []
        });
      }

      products.get(row.productId).offers.push({
        ...item,
        shop: publicShop(shop)
      });
    }

    const list = [...products.values()].map((p) => ({
      ...p,
      // A sold-out offer is still an offer — it says this shop stocks the thing
      // (HANDOFF §7.6) — but it never outranks one somebody can actually buy,
      // whatever its price. In stock first, then cheapest, then nearest.
      offers: p.offers.sort(
        (a, b) =>
          Number(b.inStock) - Number(a.inStock) ||
          Number(a.price) - Number(b.price) ||
          a.shop.distanceKm - b.shop.distanceKm
      )
    })).map((p) => ({ ...p, inStock: p.offers.some((o) => o.inStock) }));

    // Buyable products first; within each half, the cheapest leading offer.
    list.sort(
      (a, b) =>
        Number(b.inStock) - Number(a.inStock) ||
        Number(a.offers[0].price) - Number(b.offers[0].price)
    );

    const limit = parseLimit(req.query.limit, MAX_PAGE_SIZE);
    return res.status(200).json({
      status: 'success',
      count: Math.min(list.length, limit),
      products: list.slice(0, limit)
    });
  } catch (error) {
    console.error('Product Search Error:', error);
    return res.status(500).json({ message: 'Server error while searching products.' });
  }
};

/** One shelf row, as the customer app sees it — sellable or sold out. */
function shelfItem(row, shop) {
  const availableQty = sellableQty(row, shop?.safetyStockBuffer);
  return {
    inventoryId: row.id,
    productId: row.productId,
    productName: row.product.name,
    sku: row.product.sku,
    brand: row.product.brand,
    image: row.product.image,
    isVeg: row.product.isVeg,
    variantId: row.variantId,
    variantLabel: row.variant?.label ?? null,
    price: money(row.sellingPrice),
    mrp: money(row.variant?.mrp ?? row.product.mrp),
    // Sellable, never raw quantity — the safety buffer is not the customer's
    // business and the true count is not either.
    availableQty,
    // The promise, as a boolean the app can render without arithmetic. It is
    // deliberately separate from `availableQty`: if the client decides a live
    // *count* publishes too much of a shop's position (HANDOFF §7.6), the number
    // stops being sent and every screen still knows in stock from sold out.
    inStock: availableQty > 0,
    addOns: (row.product.addOns ?? []).map((a) => ({
      id: a.id,
      groupName: a.groupName,
      label: a.label,
      price: money(a.price),
      isRequired: a.isRequired,
      maxSelect: a.maxSelect
    }))
  };
}

export { shelfItem, money, parseId };
