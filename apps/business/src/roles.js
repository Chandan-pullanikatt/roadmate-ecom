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
 */
const ROLES = {
  MANUFACTURER: {
    label: 'Manufacturer',
    // A manufacturer sells; its order book is what distributors have ordered.
    ordersTitle: 'Orders received',
    sells: true,
    stats: [
      { key: 'totalSales', label: 'Total sales', icon: '₹', money: true },
      { key: 'pendingOrders', label: 'Pending', icon: '⏱' },
      { key: 'completedOrders', label: 'Delivered', icon: '✓' },
      { key: 'activeDealers', label: 'Dealers', icon: '🤝' },
      { key: 'catalogProducts', label: 'Products', icon: '▦' }
    ],
    tabs: { network: false, products: true, payouts: false },
    showsCredit: false
  },

  DISTRIBUTOR: {
    label: 'Distributor',
    // A distributor sits in the middle: it buys from manufacturers and sells to
    // shops, and `getOrders` returns both halves in one list for exactly that
    // reason. The orders screen splits them by whether this user is the seller.
    ordersTitle: 'Orders',
    sells: true,
    stats: [
      { key: 'totalPurchased', label: 'Purchased', icon: '₹', money: true },
      { key: 'pendingShipments', label: 'To dispatch', icon: '🚚' },
      { key: 'mappedShops', label: 'Shops', icon: '🏪' },
      { key: 'warehouseProducts', label: 'Products', icon: '▦' }
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
    stats: [
      { key: 'regionalRevenue', label: 'Region revenue', icon: '₹', money: true },
      { key: 'myShare', label: 'Your share', icon: '◷', money: true },
      { key: 'registeredShops', label: 'Shops', icon: '🏪' },
      { key: 'activeRiders', label: 'Riders', icon: '🛵' }
    ],
    tabs: { network: true, products: false, payouts: true },
    showsCredit: false
  }
};

/** Never returns undefined — a role with no entry gets a safe, empty shape. */
export function roleConfig(role) {
  return (
    ROLES[role] ?? {
      label: 'Executive',
      ordersTitle: 'Orders',
      sells: false,
      stats: [],
      tabs: { network: false, products: false, payouts: false },
      showsCredit: false
    }
  );
}
