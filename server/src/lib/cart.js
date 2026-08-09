// Cart loading and pricing, shared by the cart endpoints and order placement.
//
// Money here is Prisma `Decimal`, never a JS number: `0.1 + 0.2` is the wrong
// answer in a COD ledger that has to reconcile to the paisa. Add with
// `.plus()` / `.times()` and only turn it into a string at the API edge.
import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { sellableQty } from './inventory.js';
import { publicShop } from './shopRanking.js';

export const ZERO = new Prisma.Decimal(0);

/** Decimal → the string the API returns. Two places, always. */
export const toMoney = (d) => new Prisma.Decimal(d ?? 0).toFixed(2);

const cartInclude = {
  shop: true,
  items: {
    include: { product: { include: { addOns: true } }, variant: true },
    orderBy: { id: 'asc' }
  }
};

export function findCart(where) {
  return prisma.cart.findFirst({ where, include: cartInclude });
}

export function findCarts(where) {
  return prisma.cart.findMany({ where, include: cartInclude, orderBy: { id: 'asc' } });
}

/**
 * Price a cart against *today's* shelf, not against whatever it cost when the
 * item was added — the shop may have repriced or sold out in between. Returns
 * the customer-facing cart plus the raw lines order placement needs.
 */
export async function priceCart(cart) {
  if (!cart) return null;

  const shelf = await prisma.shopInventory.findMany({
    where: {
      shopId: cart.shopId,
      productId: { in: cart.items.map((i) => i.productId) }
    }
  });

  const key = (productId, variantId) => `${productId}:${variantId ?? 'null'}`;
  const byKey = new Map(shelf.map((r) => [key(r.productId, r.variantId), r]));

  let subtotal = ZERO;
  const items = cart.items.map((item) => {
    const row = byKey.get(key(item.productId, item.variantId));
    const available = sellableQty(row, cart.shop?.safetyStockBuffer);

    // A line whose shelf row vanished prices at 0 and is flagged unavailable,
    // rather than throwing — the customer must be able to open a stale cart.
    const unitPrice = row ? new Prisma.Decimal(row.sellingPrice) : ZERO;
    const addOns = (item.product.addOns ?? []).filter((a) => item.addOnIds.includes(a.id));
    const addOnTotal = addOns.reduce((sum, a) => sum.plus(a.price), ZERO);
    const lineTotal = unitPrice.plus(addOnTotal).times(item.quantity);

    if (row) subtotal = subtotal.plus(lineTotal);

    return {
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      image: item.product.image,
      variantId: item.variantId,
      variantLabel: item.variant?.label ?? null,
      quantity: item.quantity,
      note: item.note,
      unitPrice: toMoney(unitPrice),
      addOns: addOns.map((a) => ({ id: a.id, label: a.label, price: toMoney(a.price) })),
      lineTotal: toMoney(lineTotal),
      availableQty: available,
      isAvailable: Boolean(row) && available >= item.quantity,
      // Not serialised — placement needs the Decimals and the shelf row.
      _unitPrice: unitPrice,
      _addOnTotal: addOnTotal,
      _inventory: row ?? null
    };
  });

  return {
    id: cart.id,
    shopId: cart.shopId,
    shop: cart.shop ? publicShop(cart.shop) : null,
    industryId: cart.shop?.industryId ?? null,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: toMoney(subtotal),
    hasUnavailableItems: items.some((i) => !i.isAvailable),
    items,
    _subtotal: subtotal
  };
}

/** Strip the internals before a cart crosses the API boundary. */
export function publicCart(priced) {
  if (!priced) return null;
  const { _subtotal, items, ...rest } = priced;
  return {
    ...rest,
    items: items.map(({ _unitPrice, _addOnTotal, _inventory, ...item }) => item)
  };
}
