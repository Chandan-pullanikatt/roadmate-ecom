// Small shared readings of a `TradeOrder`, used by the executive list, the home
// screen and the order detail.

/** A party's display name — the business, falling back to the person. */
const partyName = (party) => party?.businessName || party?.name || '—';

/**
 * Who the other side of this order is.
 *
 * A distributor is the middle of the chain (HANDOFF §1) and appears as the
 * buyer on some rows and the seller on others, so "the other party" is the only
 * label that is correct on both — and it is what the design shows
 * (`#RM-8231 • Kannan Motors`).
 *
 * ⚠️ **Only meaningful for a role that is actually on one side.** A REGIONAL
 * partner is on neither: `sellerId === userId` is false for every row in its
 * region, so this quietly returns the *seller* every time and labels it as
 * though it were a counterparty. Use `partiesOf` for an observer — see its note.
 */
export const counterpartyOf = (order, userId) => {
  const other = order.sellerId === userId ? order.buyer : order.seller;
  return partyName(other);
};

/**
 * Both sides, for a reader who is on neither.
 *
 * A regional partner's home and order list are the trade happening *in its
 * region* — it never buys or sells (`roles.js`, `sells: false`), and it earns a
 * share of both halves. `counterpartyOf` gives it one bare name with nothing
 * saying which end that is, so "Apex Motors Corp · ₹3,52,000" reads identically
 * whether Apex was paid or was paying. Naming both, in chain order, is the only
 * form that is true for a bystander.
 */
export const partiesOf = (order) => `${partyName(order.seller)} → ${partyName(order.buyer)}`;

/** True when this user is the one who has to ship. */
export const isSeller = (order, userId) => order.sellerId === userId;

/**
 * The next status a seller can move an order to.
 *
 * `orderController.updateOrderStatus` accepts any string, and two of these
 * transitions have consequences beyond the label: Approved/Dispatched decrement
 * `Product.stockLevel`, and **Delivered writes the payout splits**. Offering a
 * fixed forward-only ladder is what stops a mistap from re-running either — the
 * controller deletes and recreates payouts on every Delivered write, so
 * re-setting Delivered is survivable, but re-setting Approved silently
 * decrements the seller's stock a second time.
 */
const LADDER = {
  Pending: { status: 'Approved', label: 'Confirm order', note: 'Reserves the stock from your catalogue.' },
  Approved: { status: 'Dispatched', label: 'Mark dispatched', note: 'Tell the buyer it is on the way.' },
  Dispatched: {
    status: 'Delivered',
    label: 'Mark delivered',
    note: 'This closes the order and pays out the partner commission splits.'
  }
};

export const nextStep = (status) => LADDER[status] ?? null;

/**
 * The ladder as an ordered list, for drawing where an order has got to.
 *
 * Derived from `LADDER` rather than written out a second time, so the picture
 * and the buttons can never disagree about what the sequence is. Cancelled is
 * deliberately absent: it is not a rung, it is leaving the ladder, and the
 * detail screen does not draw the timeline for a cancelled order at all.
 *
 * ⚠️ This is for **display**. Nothing may make a rung pressable — see the
 * warning in `app/(exec)/order/[orderId].js`.
 */
export const LADDER_STEPS = [...Object.keys(LADDER), LADDER[Object.keys(LADDER).at(-1)].status];

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

export const formatDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit'
      })
    : '';
