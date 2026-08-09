// Phase 1.8 — Razorpay: order creation for the checkout screen, and the
// webhook that is the *only* thing allowed to mark a PREPAID payment PAID.
//
// The client's own checkout callback is never trusted for that (HANDOFF §3 /
// PLAN §8) — only this server-to-server webhook, whose signature is verified
// against the raw request body before anything else happens.
import prisma from '../lib/prisma.js';
import { createOrder, verifyWebhookSignature } from '../lib/razorpay.js';
import { beginRouting } from '../lib/routing.js';
import { toMoney } from '../lib/cart.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** POST /api/customer/orders/:orderId/razorpay-order */
export const createOrderPayment = async (req, res) => {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id.' });

    const order = await prisma.consumerOrder.findFirst({
      where: { id: orderId, customerId: req.customer.id },
      include: { payment: true }
    });
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!order.payment || order.payment.method !== 'PREPAID') {
      return res.status(400).json({ message: 'This order does not need a Razorpay payment.' });
    }
    if (order.payment.status === 'PAID') {
      return res.status(409).json({ message: 'This order is already paid.' });
    }

    // Idempotent: a customer re-opening checkout gets back the same order,
    // not a second one the first payment can never complete against.
    let payment = order.payment;
    if (!payment.razorpayOrderId) {
      const amountPaise = Math.round(Number(order.grandTotal) * 100);
      const rpOrder = await createOrder({ amountPaise, receipt: order.orderNumber });
      payment = await prisma.payment.update({
        where: { id: payment.id },
        data: { razorpayOrderId: rpOrder.id }
      });
    }

    return res.status(200).json({
      status: 'success',
      razorpayOrderId: payment.razorpayOrderId,
      amount: toMoney(order.grandTotal),
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || null
    });
  } catch (error) {
    console.error('Create Razorpay Order Error:', error);
    return res.status(500).json({ message: 'Server error while creating the payment order.' });
  }
};

/**
 * POST /api/payments/razorpay/webhook — public, no auth middleware. The
 * signature *is* the authentication: a request that does not verify is
 * rejected before any database read.
 *
 * Idempotent by the same discipline as §1.5's claim: marking PAID is a
 * conditional `updateMany` on `status = PENDING`, so a Razorpay retry of an
 * already-processed event finds nothing to claim and does not re-open routing.
 */
export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhookSignature(req.rawBody, signature)) {
      return res.status(400).json({ message: 'Invalid webhook signature.' });
    }

    const event = req.body?.event;

    // A partner paying a subscription invoice through its payment link
    // (HANDOFF §7ter). Same claim discipline as a consumer payment below, and
    // the same reason: Razorpay retries, and a retry must not re-mark a month
    // paid or overwrite the reference of whoever actually settled it.
    if (event === 'payment_link.paid') {
      const link = req.body?.payload?.payment_link?.entity;
      if (!link?.id) return res.status(200).json({ status: 'ignored' });

      const paymentId = req.body?.payload?.payment?.entity?.id ?? null;
      const claimed = await prisma.subscriptionInvoice.updateMany({
        where: { paymentLinkId: link.id, status: 'DUE' },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paidVia: 'RAZORPAY_LINK',
          paymentRef: paymentId
        }
      });
      return res.status(200).json({ status: claimed.count === 1 ? 'ok' : 'ignored' });
    }

    const entity = req.body?.payload?.payment?.entity;
    if (event !== 'payment.captured' || !entity?.order_id) {
      // Ack anything we don't act on so Razorpay stops retrying it.
      return res.status(200).json({ status: 'ignored' });
    }

    const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: entity.order_id } });
    if (!payment) return res.status(200).json({ status: 'ignored' });

    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'PAID', razorpayPaymentId: entity.id }
    });

    // Only the worker that actually flipped PENDING -> PAID gets to start
    // routing — a retried webhook after that must be a no-op.
    if (claimed.count === 1) {
      await beginRouting(payment.consumerOrderId);
    }

    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Razorpay Webhook Error:', error);
    return res.status(500).json({ message: 'Server error while processing the webhook.' });
  }
};
