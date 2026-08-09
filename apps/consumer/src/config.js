// Where the API is, how often each screen re-asks it, and the one commercial
// switch this app has.
import Constants from 'expo-constants';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants.expoConfig?.extra?.apiUrl ??
  'http://localhost:5000';

/**
 * How often a screen re-asks the server.
 *
 * **Tracking is the only fast one, and 10 seconds is a decision, not a guess**
 * (PLAN §5): an order goes ROUTING → ACCEPTED → PREPARING → READY → PICKED →
 * DELIVERED with no push behind it yet, and a customer watching the screen
 * should see each step land while they are still looking. Sockets are the
 * upgrade path *if this visibly fails*, deliberately not before — a socket per
 * open order is a second connection lifecycle to get right, and polling one
 * endpoint every ten seconds is a load nothing in this system notices.
 *
 * Everything else changes only when the customer themselves does something, so
 * those screens refresh on focus (`useResource` does that for free) and poll
 * slowly or not at all.
 */
export const POLL_MS = {
  tracking: 10000,
  orders: 30000,
  // A shop can close, sell out or go off-shift while somebody is browsing it.
  // Placement re-checks all of it, so this was never a correctness problem — but
  // the client promised customers a **live** in-stock indicator (HANDOFF §7.6),
  // and a minute-old shelf is not what anybody means by live. 15 seconds is the
  // shop screen: one small query, and only while somebody is actually looking at
  // that shop.
  catalog: 15000,
  // Browse-by-product fans out across every serviceable shop, so it is the more
  // expensive of the two and it is where somebody scrolls rather than decides.
  // It stays slower on purpose; the shop screen is where a stepper gets tapped.
  search: 60000
};

/**
 * **Is online payment available at all?**
 *
 * Razorpay is code-complete on the server and stubs out until the client's
 * three env vars are set (PLAN §6); the public key id below is the client half.
 * With no key there is no checkout to open, so the app offers **cash on
 * delivery only** and says so in one line at checkout.
 *
 * This is the same rule the Rider app applied to the proof-of-delivery camera:
 * an affordance that cannot work is worse than one that is absent. What makes
 * it worth a flag rather than a hardcoded "COD only" is that the whole prepaid
 * path — placement, the gateway order, the waiting state, the webhook that
 * releases the order to a shop — is built and tested behind it. When the
 * account exists, this is one environment variable.
 *
 * ⚠️ One industry is affected more than the others: **NO_DELIVERY (gym
 * memberships) is PREPAID-only on the server**, because cash at the gym's own
 * counter is money the platform never holds but would still book commission on.
 * So with no key, memberships cannot be bought at all — and the app says that
 * plainly rather than letting a customer reach a 422 at the last tap.
 */
export const RAZORPAY_KEY_ID = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? null;
export const PREPAID_ENABLED = Boolean(RAZORPAY_KEY_ID);

/**
 * The distance beyond which a saved address is treated as "not where you are".
 * Only used to offer a nudge on the home screen; nothing routes on it.
 */
export const NEARBY_KM = 3;
