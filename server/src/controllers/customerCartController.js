// Phase 1.3 — cart CRUD.
//
// Two rules the schema encodes and this file enforces:
//   1. A cart never spans shops (`@@unique([customerId, shopId])`). Adding from
//      a second shop opens a second cart; it does not move the first one.
//   2. Nothing may be added beyond `sellableQty` — the safety buffer is the
//      ceiling, not the raw shelf count.
//
// The cart does NOT reserve stock. Reservation happens once, atomically, at
// order placement (§1.4). A cart that priced fine can still fail checkout, and
// that is the correct trade: reserving at add-to-cart would let an abandoned
// cart starve the shop.
import prisma from '../lib/prisma.js';
import { sellableQty } from '../lib/inventory.js';
import { findCart, findCarts, priceCart, publicCart } from '../lib/cart.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const parseQty = (raw, { allowZero = false } = {}) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) return null;
  if (n < 0 || (n === 0 && !allowZero)) return null;
  return n > 999 ? null : n;
};

/** Load, price and serialise one cart by id — the response every mutation returns. */
async function respondWithCart(res, cartId, status = 200) {
  const cart = await findCart({ id: cartId });
  return res.status(status).json({ status: 'success', cart: publicCart(await priceCart(cart)) });
}

/** GET /api/customer/cart[?shopId=] */
export const getCart = async (req, res) => {
  try {
    const shopId = req.query.shopId ? parseId(req.query.shopId) : null;
    if (req.query.shopId && !shopId) return res.status(400).json({ message: 'Invalid shopId.' });

    const carts = await findCarts({
      customerId: req.customer.id,
      ...(shopId ? { shopId } : {})
    });

    const priced = await Promise.all(carts.map(priceCart));
    return res.status(200).json({ status: 'success', carts: priced.map(publicCart) });
  } catch (error) {
    console.error('Get Cart Error:', error);
    return res.status(500).json({ message: 'Server error while loading the cart.' });
  }
};

/** POST /api/customer/cart/items */
export const addCartItem = async (req, res) => {
  try {
    const shopId = parseId(req.body?.shopId);
    const productId = parseId(req.body?.productId);
    const variantId = req.body?.variantId == null ? null : parseId(req.body.variantId);
    const quantity = parseQty(req.body?.quantity ?? 1);
    const addOnIds = Array.isArray(req.body?.addOnIds)
      ? [...new Set(req.body.addOnIds.map(parseId).filter(Boolean))].sort((a, b) => a - b)
      : [];
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;

    if (!shopId || !productId || !quantity) {
      return res.status(400).json({ message: 'shopId, productId and a positive quantity are required.' });
    }
    if (req.body?.variantId != null && !variantId) {
      return res.status(400).json({ message: 'Invalid variantId.' });
    }

    const shop = await prisma.user.findFirst({
      where: { id: shopId, role: 'SHOP', isActive: true }
    });
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });

    const inventory = await prisma.shopInventory.findFirst({
      where: { shopId, productId, variantId, isAvailable: true }
    });
    if (!inventory) {
      return res.status(404).json({ message: 'This shop does not stock that item.' });
    }

    const cart = await prisma.cart.upsert({
      where: { customerId_shopId: { customerId: req.customer.id, shopId } },
      create: { customerId: req.customer.id, shopId },
      update: {}
    });

    // Same product + variant + add-on set is the same line: increment it rather
    // than stacking near-identical rows the customer then has to delete twice.
    const existing = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId, variantId, addOnIds: { equals: addOnIds } }
    });

    const nextQty = (existing?.quantity ?? 0) + quantity;
    const available = sellableQty(inventory, shop.safetyStockBuffer);
    if (nextQty > available) {
      return res.status(409).json({
        message: available > 0
          ? `Only ${available} left at this shop.`
          : 'This item just went out of stock.',
        availableQty: available
      });
    }

    if (existing) {
      await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: nextQty, note } });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, productId, variantId, quantity, addOnIds, note }
      });
    }

    return respondWithCart(res, cart.id, existing ? 200 : 201);
  } catch (error) {
    console.error('Add Cart Item Error:', error);
    return res.status(500).json({ message: 'Server error while updating the cart.' });
  }
};

/** PATCH /api/customer/cart/items/:itemId — quantity 0 removes the line. */
export const updateCartItem = async (req, res) => {
  try {
    const itemId = parseId(req.params.itemId);
    const quantity = parseQty(req.body?.quantity, { allowZero: true });

    if (!itemId) return res.status(400).json({ message: 'Invalid item id.' });
    if (quantity == null) return res.status(400).json({ message: 'A quantity of 0 or more is required.' });

    // Scoped by customerId, so another customer's item is a 404, not a 403 —
    // the caller learns nothing about ids that are not theirs.
    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cart: { customerId: req.customer.id } },
      include: { cart: { include: { shop: true } } }
    });
    if (!item) return res.status(404).json({ message: 'Cart item not found.' });

    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id: item.id } });
      return respondWithCart(res, item.cartId);
    }

    const inventory = await prisma.shopInventory.findFirst({
      where: {
        shopId: item.cart.shopId,
        productId: item.productId,
        variantId: item.variantId,
        isAvailable: true
      }
    });
    const available = sellableQty(inventory, item.cart.shop?.safetyStockBuffer);
    if (quantity > available) {
      return res.status(409).json({
        message: available > 0 ? `Only ${available} left at this shop.` : 'This item just went out of stock.',
        availableQty: available
      });
    }

    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    return respondWithCart(res, item.cartId);
  } catch (error) {
    console.error('Update Cart Item Error:', error);
    return res.status(500).json({ message: 'Server error while updating the cart.' });
  }
};

/** DELETE /api/customer/cart/items/:itemId */
export const removeCartItem = async (req, res) => {
  try {
    const itemId = parseId(req.params.itemId);
    if (!itemId) return res.status(400).json({ message: 'Invalid item id.' });

    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cart: { customerId: req.customer.id } }
    });
    if (!item) return res.status(404).json({ message: 'Cart item not found.' });

    await prisma.cartItem.delete({ where: { id: item.id } });
    return respondWithCart(res, item.cartId);
  } catch (error) {
    console.error('Remove Cart Item Error:', error);
    return res.status(500).json({ message: 'Server error while updating the cart.' });
  }
};

/** DELETE /api/customer/cart/:cartId */
export const clearCart = async (req, res) => {
  try {
    const cartId = parseId(req.params.cartId);
    if (!cartId) return res.status(400).json({ message: 'Invalid cart id.' });

    const cart = await prisma.cart.findFirst({ where: { id: cartId, customerId: req.customer.id } });
    if (!cart) return res.status(404).json({ message: 'Cart not found.' });

    await prisma.cart.delete({ where: { id: cart.id } });
    return res.status(200).json({ status: 'success', message: 'Cart cleared.' });
  } catch (error) {
    console.error('Clear Cart Error:', error);
    return res.status(500).json({ message: 'Server error while clearing the cart.' });
  }
};
