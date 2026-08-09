// Phase 1.8 — Razorpay integration. Blocked on the client's account (PLAN §7.2):
// same shape as `sendOtpSms` — real behaviour switches on once RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET are set in the environment, and a stub keeps every other
// phase (and every test) runnable without live credentials.
//
// Signature verification is the one exception: it is pure HMAC, not a network
// call, so it is real regardless of credentials — the webhook must never trust
// a request it cannot verify, and a missing secret fails closed rather than
// open.
import crypto from 'node:crypto';

const keyId = () => process.env.RAZORPAY_KEY_ID;
const keySecret = () => process.env.RAZORPAY_KEY_SECRET;
const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET;

const isLive = () => Boolean(keyId() && keySecret());

const authHeader = () => `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}`;

/**
 * HMAC-SHA256 of the raw request body against RAZORPAY_WEBHOOK_SECRET,
 * timing-safe compared against the `X-Razorpay-Signature` header. `rawBody`
 * must be the exact bytes Razorpay signed — a re-serialised JSON object will
 * not match.
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = webhookSecret();
  if (!secret || !signature || !rawBody) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * A Razorpay order for the checkout screen to open against. Stubbed until the
 * client pays for an account — the stub id is unmistakably fake so nothing
 * downstream can confuse it for a real gateway order.
 */
export async function createOrder({ amountPaise, receipt }) {
  if (!isLive()) {
    return { id: `order_stub_${receipt}`, amount: amountPaise, currency: 'INR', stub: true };
  }

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt })
  });
  if (!res.ok) throw new Error(`Razorpay order create failed: ${res.status}`);
  return res.json();
}

/**
 * Refund a captured payment. Called best-effort, fire-and-forget, from
 * `closePaymentAsRefundable` (`lib/routing.js`) the moment a refund becomes
 * owed — the debt is recorded in `Payment` regardless of whether this call
 * succeeds, so a stub or a transient gateway failure never blocks the order
 * from closing.
 */
export async function refundPayment({ razorpayPaymentId, amount }) {
  if (!isLive()) {
    return { id: `rfnd_stub_${razorpayPaymentId}`, amount: String(amount), stub: true };
  }

  const res = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ amount: Math.round(Number(amount) * 100) })
  });
  if (!res.ok) throw new Error(`Razorpay refund failed: ${res.status}`);
  return res.json();
}

/**
 * A Razorpay **payment link** for a subscription invoice (HANDOFF §7ter).
 *
 * Deliberately a link and not an auto-debit mandate: the client's answer is a
 * manual monthly invoice the partner pays, and mandates are worth building at a
 * few hundred partners rather than at launch. A link is also the only shape
 * that works for a partner who has no app open — it is a URL you can put in a
 * WhatsApp message.
 *
 * Stubbed without credentials, like everything else here. The stub URL is
 * unmistakably fake so nothing downstream can mistake it for something a
 * partner could actually pay.
 */
export async function createPaymentLink({ amountPaise, reference, description, customer = {} }) {
  if (!isLive()) {
    return {
      id: `plink_stub_${reference}`,
      short_url: `https://rzp.io/stub/${reference}`,
      reference_id: reference,
      amount: amountPaise,
      stub: true
    };
  }

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      description,
      reference_id: reference,
      customer: {
        name: customer.name || undefined,
        contact: customer.phone || undefined,
        email: customer.email || undefined
      },
      notify: { sms: Boolean(customer.phone), email: Boolean(customer.email) },
      reminder_enable: true
    })
  });
  if (!res.ok) throw new Error(`Razorpay payment link create failed: ${res.status}`);
  return res.json();
}

export { isLive };
