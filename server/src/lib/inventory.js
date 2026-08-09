// What the app is allowed to sell out of a shelf.
//
// Never `quantity`. The shop also sells to walk-in customers at the counter and
// only corrects the number afterwards, so `User.safetyStockBuffer` (a percent,
// default 90) holds a slice back to absorb that drift. `reserved` is stock
// already promised to in-flight consumer orders.

/**
 * @param {{quantity:number, reserved:number, isAvailable:boolean}} row ShopInventory
 * @param {number|null|undefined} safetyStockBuffer percent, from User
 * @returns {number} units the customer app may offer, never negative
 */
export function sellableQty(row, safetyStockBuffer) {
  if (!row || row.isAvailable === false) return 0;

  const free = (row.quantity ?? 0) - (row.reserved ?? 0);
  if (free <= 0) return 0;

  // A missing or nonsense buffer means "sell everything free" rather than
  // "sell nothing" — a null column must not silently delist a shop.
  const pct = Number.isFinite(safetyStockBuffer) ? Math.min(Math.max(safetyStockBuffer, 0), 100) : 100;

  return Math.floor((free * pct) / 100);
}

/**
 * How much free stock a line needs so that `sellableQty` still covers it —
 * `sellableQty` solved for `free`.
 *
 * The buffer is applied in reverse: the customer may take `n`, so the shelf must
 * hold `ceil(n * 100 / buffer)` free units. Reserving the raw `n` would eat
 * straight through the counter-sales cushion.
 *
 * Both reservation sites use this: placement (§1.4) and reroute (§1.5). They
 * must agree exactly, or a reroute silently changes how much cushion is held.
 */
export function requiredFreeUnits(quantity, safetyStockBuffer) {
  const pct =
    Number.isFinite(safetyStockBuffer) && safetyStockBuffer > 0
      ? Math.min(safetyStockBuffer, 100)
      : 100;
  return Math.ceil((quantity * 100) / pct);
}
