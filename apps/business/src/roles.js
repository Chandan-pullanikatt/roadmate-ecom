// What each of the three executive roles is, in one table.
//
// One codebase, four roles (HANDOFF §4). The alternative to this file is the
// same `if (role === 'MANUFACTURER')` ladder repeated in the layout, the home
// screen and the profile — three places to forget when a fourth role arrives.
//
// The shape is dictated by the backend, not chosen here:
//
//   • `stats` mirrors `dashboardController.getOverview`, which returns a
//     *different set of keys per role*. There is no generic renderer for it.
//   • `tabs` reflects which endpoints actually return something. A
//     MANUFACTURER falls through `getActivePartners`' role ladder to the
//     fail-safe empty clause and through `getPendingApprovals`' to `[]`, so it
//     has no network to show — hiding the tab is honest, an empty tab is not.
//   • Only REGIONAL is a payout recipient: `orderController.updateOrderStatus`
//     splits the commission pool to STATE / IND_STATE / DISTRICT / REGIONAL /
//     MASTER, and of these three roles only Regional is on that list.

/** Roles this app's executive section serves. SHOP has its own section. */
export const EXEC_ROLES = ['DISTRIBUTOR', 'MANUFACTURER', 'REGIONAL'];

export const isExecRole = (role) => EXEC_ROLES.includes(role);

/**
 * `money: true` marks a B2B `Float` that must go through `formatAmount`.
 * These are not Decimal strings — `TradeOrder.totalAmount` is deliberately
 * still a float and a server test enforces it (PLAN §1).
 *
 * ⚠️ **`icon` names a concept from `ICONS`, never a character** (HANDOFF §5).
 * These were `₹ ⏱ ✓ 🤝 ▦ 🚚 🏪 ◷ 🛵` until 2026-08-12: a mix of Unicode
 * typographic glyphs, which go tofu wherever the device font lacks them, and
 * full-colour emoji, which do not — side by side in one row. That is why the
 * grid never read as a set. `▦` and `🏪` are not drawings from the same hand and
 * no `fontSize` was ever going to make them agree.
 *
 * ── `headline` vs `stats` ────────────────────────────────────────────────────
 *
 * Every role's overview has exactly one figure that answers "how is the business
 * doing" and three or four that are counts of things. They used to be one flat
 * list rendered as one flat grid of equal tiles, so the ₹ figure — the only one
 * anybody opens the app for — was set at the same size as the product count.
 *
 * `headline` is that figure and gets the hero card; `stats` are the counts and
 * sit inside it. The split lives here rather than in the screen for the same
 * reason everything else in this file does: the screen still knows nothing about
 * what a manufacturer is.
 *
 * `actionable: true` marks a count that is *work waiting for this partner*
 * rather than a fact about them. It is drawn in the accent when it is non-zero,
 * so "3 to dispatch" is visibly a different kind of number from "48 products".
 */
const ROLES = {
  MANUFACTURER: {
    label: 'Manufacturer',
    // A manufacturer sells; its order book is what distributors have ordered.
    ordersTitle: 'Orders received',
    sells: true,
    headline: {
      key: 'totalSales',
      label: 'Total sales',
      caption: 'Everything distributors have ordered from you',
      money: true
    },
    stats: [
      { key: 'pendingOrders', label: 'Open', icon: 'pending', actionable: true, to: '/(exec)/orders' },
      { key: 'completedOrders', label: 'Delivered', icon: 'deliveries', to: '/(exec)/orders' },
      // No `to`: a manufacturer has no Network tab (see `tabs` below), so this
      // one is a figure and not a door.
      { key: 'activeDealers', label: 'Dealers', icon: 'dealers' },
      { key: 'catalogProducts', label: 'Products', icon: 'stock', to: '/(exec)/products' }
    ],
    tabs: { network: false, products: true, payouts: false },
    showsCredit: false
  },

  DISTRIBUTOR: {
    label: 'Distributor',
    // A distributor sits in the middle: it buys from manufacturers and sells to
    // shops, and `getOrders` returns both halves in one list for exactly that
    // reason. The orders screen splits them by whether this user is the seller.
    ordersTitle: 'Recent orders',
    sells: true,
    headline: {
      key: 'totalPurchased',
      label: 'Stock purchased',
      // `getOverview` filters this to `status: 'Delivered'`, and a figure that
      // quietly excludes everything in transit is worth saying out loud —
      // unqualified, it reads as "you have bought nothing" on a day with three
      // lorries on the road.
      caption: 'Delivered purchases, all time',
      money: true
    },
    stats: [
      { key: 'pendingShipments', label: 'To dispatch', icon: 'dispatch', actionable: true, to: '/(exec)/orders' },
      { key: 'mappedShops', label: 'Shops', icon: 'shop', to: '/(exec)/network' },
      { key: 'warehouseProducts', label: 'Products', icon: 'stock', to: '/(exec)/products' }
    ],
    tabs: { network: true, products: true, payouts: false },
    // Only a distributor is owed money by the shops it supplies, so it is the
    // only role shown their `outstandingDue` / `creditLimit`.
    showsCredit: true
  },

  REGIONAL: {
    label: 'Regional partner',
    // A regional partner sells nothing. It onboards shops and riders and earns
    // a share of what its region trades, so its screens are people and money —
    // not a catalogue.
    ordersTitle: 'Orders in your region',
    sells: false,
    headline: {
      key: 'regionalRevenue',
      label: 'Region revenue',
      caption: 'Everything traded in your region',
      money: true
    },
    stats: [
      { key: 'myShare', label: 'Your share', icon: 'earnings', money: true },
      { key: 'registeredShops', label: 'Shops', icon: 'shop', to: '/(exec)/network' },
      { key: 'activeRiders', label: 'Riders', icon: 'rider', to: '/(exec)/network' }
    ],
    tabs: { network: true, products: false, payouts: true },
    showsCredit: false
  }
};

/**
 * Never returns undefined — a role with no entry gets a safe, empty shape.
 *
 * ⚠️ `headline` is **null** in the fallback and the home screen must survive
 * that: an unknown role is exactly the case where inventing a hero figure out of
 * whichever key happened to be first would put a number on screen that nobody
 * can vouch for.
 */
export function roleConfig(role) {
  return (
    ROLES[role] ?? {
      label: 'Executive',
      ordersTitle: 'Orders',
      sells: false,
      headline: null,
      stats: [],
      tabs: { network: false, products: false, payouts: false },
      showsCredit: false
    }
  );
}
