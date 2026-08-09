// Phase 2 — the shelf, from the shop's side.
//
// Every other reader of `ShopInventory` so far has been customer-facing
// (`lib/inventory.js`, `lib/cart.js`, `lib/shopRanking.js`) and read-only. The
// only writers were the pipeline itself: placement reserves, a reroute moves the
// reservation, delivery decrements, a stockout bumps the counter. Nothing let the
// human who owns the shelf correct it — which is the whole premise of
// HANDOFF §3's "live per-shop stock maintained by shop owners".
//
// Two rules this file exists to enforce:
//
//   1. THE SHOP OWNS `quantity`, THE PIPELINE OWNS `reserved`. A count
//      correction may never take `quantity` below `reserved`: those units are
//      already promised to orders in flight, and the shelf going under them is
//      how the platform sells stock it does not have. The write is a conditional
//      `updateMany` re-asserting `quantity >= reserved`, the same claim
//      discipline as §1.4/§1.5 — not a read, a compare, and a hope.
//
//   2. RE-CONFIRMING IS AN EXPLICIT ACT. Three consecutive stockouts auto-hide a
//      SKU "until re-confirmed" (HANDOFF §3) and until now nothing could
//      re-confirm it. `confirmInventory` is that verb, and it is the *only*
//      thing that clears `consecutiveStockouts`, because a shop flipping
//      `isAvailable` back on without recounting is exactly the drift the
//      auto-hide was built to catch.
import prisma from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { toMoney } from '../lib/cart.js';
import { sellableQty } from '../lib/inventory.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';
import { isValidLatLng } from '../lib/geo.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * `protect` selects a narrow set of columns and `safetyStockBuffer` is not among
 * them — but it is what turns `quantity` into a sellable number, so the shop row
 * is re-read. Same reason `shopOrderController.etaForShop` re-reads it.
 */
function shopColumns(shopId) {
  return prisma.user.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      safetyStockBuffer: true,
      isOpen: true,
      openTime: true,
      closeTime: true,
      prepTimeMin: true,
      usesOwnRiders: true,
      latitude: true,
      longitude: true,
      serviceRadiusKm: true
    }
  });
}

const rowInclude = {
  product: { select: { id: true, name: true, sku: true, image: true, brand: true } },
  variant: { select: { id: true, label: true } }
};

/**
 * What the stock screen renders.
 *
 * `sellable` is shown next to `quantity` deliberately: the difference between
 * them is the reservation plus the safety buffer, and a shop owner who cannot
 * see why "12 in stock" offers 9 will assume the app is broken.
 */
function inventoryView(row, buffer, hideThreshold) {
  const autoHidden = !row.isAvailable && row.consecutiveStockouts >= hideThreshold;
  return {
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    name: row.product?.name ?? null,
    sku: row.product?.sku ?? null,
    brand: row.product?.brand ?? null,
    image: row.product?.image ?? null,
    variantLabel: row.variant?.label ?? null,

    quantity: row.quantity,
    reserved: row.reserved,
    sellable: sellableQty(row, buffer),
    sellingPrice: toMoney(row.sellingPrice),
    isAvailable: row.isAvailable,

    consecutiveStockouts: row.consecutiveStockouts,
    // The screen needs to tell "the shop switched this off" apart from "the
    // platform switched this off", because only the second one needs a recount.
    autoHidden,
    lastConfirmedAt: row.lastConfirmedAt,
    updatedAt: row.updatedAt
  };
}

/** Parse a money string into a Decimal, or null if it is not one. */
function parsePrice(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const d = new Prisma.Decimal(raw);
    if (!d.isFinite() || d.isNegative() || d.greaterThan('999999.99')) return null;
    return d;
  } catch {
    return null;
  }
}

/** Parse a non-negative integer count, or null. */
function parseCount(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : null;
}

/** GET /api/shop/inventory — the whole shelf, newest corrections last. */
export const listInventory = async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const shop = await shopColumns(req.user.id);
    const hideThreshold = await getConfigNumber(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, req.user.industryId);

    const rows = await prisma.shopInventory.findMany({
      where: {
        shopId: req.user.id,
        ...(search
          ? {
              product: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { sku: { contains: search, mode: 'insensitive' } }
                ]
              }
            }
          : {})
      },
      include: rowInclude,
      orderBy: [{ isAvailable: 'desc' }, { id: 'asc' }],
      take: 300
    });

    return res.status(200).json({
      status: 'success',
      // The buffer is echoed because the screen explains the gap between
      // `quantity` and `sellable` with it.
      safetyStockBuffer: shop?.safetyStockBuffer ?? null,
      items: rows.map((r) => inventoryView(r, shop?.safetyStockBuffer, hideThreshold))
    });
  } catch (error) {
    console.error('List Inventory Error:', error);
    return res.status(500).json({ message: 'Server error while loading your stock.' });
  }
};

/**
 * POST /api/shop/inventory — put a product on this shelf.
 *
 * An upsert on the `[shopId, productId, variantId]` unique key, so re-adding a
 * product the shop already carries is a price/count correction rather than a
 * 500 from a constraint violation.
 */
export const addInventory = async (req, res) => {
  try {
    const productId = parseId(req.body?.productId);
    if (!productId) return res.status(400).json({ message: 'A productId is required.' });

    const variantId = req.body?.variantId == null ? null : parseId(req.body.variantId);
    if (req.body?.variantId != null && !variantId) {
      return res.status(400).json({ message: 'Invalid variantId.' });
    }

    const quantity = parseCount(req.body?.quantity) ?? 0;
    const sellingPrice = parsePrice(req.body?.sellingPrice);
    if (!sellingPrice) return res.status(400).json({ message: 'A valid sellingPrice is required.' });

    // A shop may only stock products in its own industry — otherwise a grocery
    // shelf can carry a pharmacy SKU and §1.9's prescription gate never fires.
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, industryId: true }
    });
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    if (req.user.industryId && product.industryId !== req.user.industryId) {
      return res.status(403).json({ message: 'That product is not in your industry.' });
    }

    const now = new Date();

    // Not `upsert`: the unique key is `[shopId, productId, variantId]` and
    // `variantId` is nullable, which Prisma will not accept in a compound unique
    // `where`. Find-then-write, and the worst a race loses is one of two
    // identical corrections.
    const existing = await prisma.shopInventory.findFirst({
      where: { shopId: req.user.id, productId, variantId }
    });

    const row = existing
      ? await prisma.shopInventory.update({
          where: { id: existing.id },
          // Adding something already on the shelf is a recount, so it clears the
          // stockout counter for the same reason `confirmInventory` does.
          data: {
            quantity,
            sellingPrice,
            isAvailable: true,
            consecutiveStockouts: 0,
            lastConfirmedAt: now
          },
          include: rowInclude
        })
      : await prisma.shopInventory.create({
          data: {
            shopId: req.user.id,
            productId,
            variantId,
            quantity,
            sellingPrice,
            isAvailable: true,
            lastConfirmedAt: now
          },
          include: rowInclude
        });

    const shop = await shopColumns(req.user.id);
    const hideThreshold = await getConfigNumber(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, req.user.industryId);
    return res
      .status(201)
      .json({ status: 'success', item: inventoryView(row, shop?.safetyStockBuffer, hideThreshold) });
  } catch (error) {
    console.error('Add Inventory Error:', error);
    return res.status(500).json({ message: 'Server error while adding stock.' });
  }
};

/**
 * PATCH /api/shop/inventory/:inventoryId — correct the count, the price, or
 * pull the SKU off sale.
 *
 * The count write is conditional on `quantity >= reserved` *after* the change,
 * evaluated in the database. A shop that has just sold its last two units at the
 * counter while two are reserved for an in-flight order gets a 409 telling it
 * exactly how many are spoken for — which is true and actionable — rather than a
 * silently clamped number that would oversell.
 */
export const updateInventory = async (req, res) => {
  try {
    const id = parseId(req.params.inventoryId);
    if (!id) return res.status(400).json({ message: 'Invalid inventory id.' });

    const row = await prisma.shopInventory.findFirst({ where: { id, shopId: req.user.id } });
    if (!row) return res.status(404).json({ message: 'That item is not on your shelf.' });

    const data = {};
    const now = new Date();

    if (req.body?.quantity !== undefined) {
      const quantity = parseCount(req.body.quantity);
      if (quantity === null) return res.status(400).json({ message: 'Invalid quantity.' });
      if (quantity < row.reserved) {
        return res.status(409).json({
          message: `${row.reserved} unit(s) are already promised to orders in flight; the count cannot go below that.`,
          reason: 'BELOW_RESERVED',
          reserved: row.reserved
        });
      }
      data.quantity = quantity;
      // Typing a count *is* confirming it.
      data.lastConfirmedAt = now;
    }

    if (req.body?.sellingPrice !== undefined) {
      const price = parsePrice(req.body.sellingPrice);
      if (!price) return res.status(400).json({ message: 'Invalid sellingPrice.' });
      data.sellingPrice = price;
    }

    if (req.body?.isAvailable !== undefined) {
      const next = Boolean(req.body.isAvailable);
      const hideThreshold = await getConfigNumber(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, req.user.industryId);
      // An auto-hidden SKU cannot be switched back on from this endpoint. The
      // platform hid it because the shelf lied three times; the way back is a
      // recount (`/confirm`), not a toggle.
      if (next && !row.isAvailable && row.consecutiveStockouts >= hideThreshold) {
        return res.status(409).json({
          message: 'This item was hidden after repeated stockouts. Confirm the count to put it back on sale.',
          reason: 'NEEDS_CONFIRMATION',
          consecutiveStockouts: row.consecutiveStockouts
        });
      }
      data.isAvailable = next;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    // The claim: `reserved` may have risen between the read above and here (a
    // customer placing an order is one `UPDATE` away at all times), so the
    // predicate is re-asserted in the database rather than trusted from the read.
    const moved = await prisma.shopInventory.updateMany({
      where: {
        id,
        shopId: req.user.id,
        ...(data.quantity === undefined ? {} : { reserved: { lte: data.quantity } })
      },
      data
    });
    if (moved.count === 0) {
      const fresh = await prisma.shopInventory.findFirst({ where: { id, shopId: req.user.id } });
      return res.status(409).json({
        message: 'Stock moved while you were editing; check the count and try again.',
        reason: 'BELOW_RESERVED',
        reserved: fresh?.reserved ?? row.reserved
      });
    }

    const fresh = await prisma.shopInventory.findUnique({ where: { id }, include: rowInclude });
    const shop = await shopColumns(req.user.id);
    const hideThreshold = await getConfigNumber(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, req.user.industryId);
    return res
      .status(200)
      .json({ status: 'success', item: inventoryView(fresh, shop?.safetyStockBuffer, hideThreshold) });
  } catch (error) {
    console.error('Update Inventory Error:', error);
    return res.status(500).json({ message: 'Server error while updating stock.' });
  }
};

/**
 * POST /api/shop/inventory/:inventoryId/confirm — "I have counted this shelf."
 *
 * HANDOFF §3's missing half. Clears `consecutiveStockouts`, puts the SKU back on
 * sale, and stamps `lastConfirmedAt`. Optionally takes the recounted `quantity`,
 * because the realistic flow is *count it, then confirm it* in one action —
 * still refused below `reserved`, for the same reason as `updateInventory`.
 */
export const confirmInventory = async (req, res) => {
  try {
    const id = parseId(req.params.inventoryId);
    if (!id) return res.status(400).json({ message: 'Invalid inventory id.' });

    const row = await prisma.shopInventory.findFirst({ where: { id, shopId: req.user.id } });
    if (!row) return res.status(404).json({ message: 'That item is not on your shelf.' });

    let quantity;
    if (req.body?.quantity !== undefined) {
      quantity = parseCount(req.body.quantity);
      if (quantity === null) return res.status(400).json({ message: 'Invalid quantity.' });
      if (quantity < row.reserved) {
        return res.status(409).json({
          message: `${row.reserved} unit(s) are already promised to orders in flight; the count cannot go below that.`,
          reason: 'BELOW_RESERVED',
          reserved: row.reserved
        });
      }
    }

    const moved = await prisma.shopInventory.updateMany({
      where: {
        id,
        shopId: req.user.id,
        ...(quantity === undefined ? {} : { reserved: { lte: quantity } })
      },
      data: {
        ...(quantity === undefined ? {} : { quantity }),
        consecutiveStockouts: 0,
        isAvailable: true,
        lastConfirmedAt: new Date()
      }
    });
    if (moved.count === 0) {
      return res.status(409).json({
        message: 'Stock moved while you were counting; check the count and try again.',
        reason: 'BELOW_RESERVED'
      });
    }

    const fresh = await prisma.shopInventory.findUnique({ where: { id }, include: rowInclude });
    const shop = await shopColumns(req.user.id);
    const hideThreshold = await getConfigNumber(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, req.user.industryId);
    return res
      .status(200)
      .json({ status: 'success', item: inventoryView(fresh, shop?.safetyStockBuffer, hideThreshold) });
  } catch (error) {
    console.error('Confirm Inventory Error:', error);
    return res.status(500).json({ message: 'Server error while confirming stock.' });
  }
};

/**
 * GET /api/shop/storefront — the Home screen's header state.
 * PATCH /api/shop/storefront — the "Shop is open" toggle and its hours.
 *
 * `isOpen` is not cosmetic: `rankCandidateShops` only ever considers open shops,
 * so this toggle is the shop's own switch out of the routing pool.
 */
export const getStorefront = async (req, res) => {
  try {
    const shop = await shopColumns(req.user.id);
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });
    return res.status(200).json({ status: 'success', storefront: publicStorefront(shop) });
  } catch (error) {
    console.error('Get Storefront Error:', error);
    return res.status(500).json({ message: 'Server error while loading your shop.' });
  }
};

const publicStorefront = (shop) => ({
  isOpen: shop.isOpen,
  openTime: shop.openTime,
  closeTime: shop.closeTime,
  prepTimeMin: shop.prepTimeMin,
  safetyStockBuffer: shop.safetyStockBuffer,
  usesOwnRiders: shop.usesOwnRiders,
  latitude: shop.latitude,
  longitude: shop.longitude,
  serviceRadiusKm: shop.serviceRadiusKm,
  // A separate boolean rather than leaving the app to test two nulls, because
  // this is the one storefront fact that silently un-lists the shop: a shop
  // onboarded before coordinates were captured is open, stocked, and invisible.
  // The app renders it as the blocking state it is.
  locationSet: shop.latitude !== null && shop.longitude !== null
});

/** "09:00" / "20:00" — the only shape the dashboards already store. */
const isClockString = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const updateStorefront = async (req, res) => {
  try {
    const data = {};

    if (req.body?.isOpen !== undefined) data.isOpen = Boolean(req.body.isOpen);

    for (const field of ['openTime', 'closeTime']) {
      if (req.body?.[field] !== undefined) {
        if (req.body[field] !== null && !isClockString(req.body[field])) {
          return res.status(400).json({ message: `${field} must be "HH:MM".` });
        }
        data[field] = req.body[field];
      }
    }

    if (req.body?.prepTimeMin !== undefined) {
      // §1.9 — only COOK_AND_DELIVER reads this, but a kitchen setting it while
      // its industry is something else is harmless, so it is not gated here.
      const n = req.body.prepTimeMin === null ? null : parseCount(req.body.prepTimeMin);
      if (req.body.prepTimeMin !== null && (n === null || n > 240)) {
        return res.status(400).json({ message: 'prepTimeMin must be 0–240 minutes.' });
      }
      data.prepTimeMin = n;
    }

    // The delivery-mode switch (HANDOFF §3). It belongs on the storefront and
    // not on the staff screen because it is the same *kind* of setting as
    // "Shop is open": both decide what the routing engine does with this shop.
    //
    // Turning it on with nobody hired is allowed and is not silently ignored —
    // the shop simply becomes unserviceable until somebody goes on shift, which
    // is the truth and is visible on both screens. Refusing it here would mean
    // a shop could not set up its staff and its mode in whichever order it
    // liked.
    if (req.body?.usesOwnRiders !== undefined) {
      data.usesOwnRiders = Boolean(req.body.usesOwnRiders);
    }

    // Where the shop is. The shop may correct its own pin — it is the only party
    // that actually knows, and a shop onboarded before coordinates were captured
    // (or dropped on the wrong side of the road by whoever onboarded it) has no
    // other way to become findable.
    //
    // The two must move together: accepting one alone would let a shop end up at
    // its old latitude and a new longitude, which is a real place, somewhere
    // else, that a rider would be sent to.
    if (req.body?.latitude !== undefined || req.body?.longitude !== undefined) {
      const lat = Number.parseFloat(req.body.latitude);
      const lng = Number.parseFloat(req.body.longitude);
      if (!isValidLatLng(lat, lng)) {
        return res.status(400).json({
          message: 'Set latitude and longitude together, as a valid coordinate pair.',
          reason: 'BAD_LOCATION'
        });
      }
      data.latitude = lat;
      data.longitude = lng;
    }

    // `serviceRadiusKm` is deliberately NOT settable here, for the same reason
    // as `safetyStockBuffer` below: how far the platform will send a rider is a
    // commercial term, not the shop's dial. It is set at onboarding and by an
    // operator. The shop is shown its radius (`publicStorefront`) so the number
    // is never a secret — it just is not the shop's to raise.

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    // `safetyStockBuffer` is deliberately NOT settable here: it is the platform's
    // protection against a shop overselling, not the shop's own dial.
    await prisma.user.update({ where: { id: req.user.id }, data });
    const shop = await shopColumns(req.user.id);
    return res.status(200).json({ status: 'success', storefront: publicStorefront(shop) });
  } catch (error) {
    console.error('Update Storefront Error:', error);
    return res.status(500).json({ message: 'Server error while updating your shop.' });
  }
};
