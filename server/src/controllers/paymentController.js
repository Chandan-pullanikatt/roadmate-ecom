// Phase 1.8 — Razorpay: order creation for the checkout screen, and the
// webhook that is the *only* thing allowed to mark a PREPAID payment PAID.
//
// The client's own checkout callback is never trusted for that (HANDOFF §3 /
// PLAN §8) — only this server-to-server webhook, whose signature is verified
// against the raw request body before anything else happens.
import prisma from '../lib/prisma.js';
import { createOrder, verifyWebhookSignature, isLive } from '../lib/razorpay.js';
import { beginRouting } from '../lib/routing.js';
import { toMoney } from '../lib/cart.js';
import { signPaymentPageToken, orderIdFromPaymentPageToken } from '../lib/paymentPageToken.js';
import { renderCheckoutPage, renderMessagePage } from '../lib/checkoutPage.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Where the customer's browser can reach this server.
 *
 * `PUBLIC_BASE_URL` when it is set — a deployed host, or the tunnel that fronts
 * a laptop — and otherwise the host the request itself arrived on, which is
 * already an address the phone could reach, since the phone is what asked.
 * Deriving it is what keeps a LAN dev setup working with no configuration.
 *
 * ⚠️ Razorpay's checkout script is served over https and browsers increasingly
 * refuse to run it inside a plain-http page. Over the LAN that is a warning; on
 * anything public it is a hard failure, so a real deployment must set
 * `PUBLIC_BASE_URL` to an https origin.
 */
const publicBaseUrl = (req) => {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
};

/**
 * Back into the app, at the screen already watching this order.
 *
 * The scheme is `apps/consumer/app.json`'s, and it is configurable because the
 * three apps do not share one — only the Customer app has a checkout.
 */
const appDeepLink = (orderId) => `${process.env.APP_SCHEME || 'roadmate'}://order/${orderId}`;

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

    // `paymentUrl` is the whole hand-off (2026-08-12): the app opens this in the
    // phone's browser and Razorpay's checkout runs there. Additive — every field
    // this endpoint has always returned is still returned, because the shape is
    // pinned by tests and because a client that wants to drive checkout itself
    // one day (a web storefront, say) still has everything it needs.
    //
    // The ticket is minted per request rather than stored: it expires in fifteen
    // minutes, and asking again is one tap on an order screen that is already
    // polling.
    const paymentUrl = `${publicBaseUrl(req)}/pay/${order.id}?t=${signPaymentPageToken(order.id)}`;

    return res.status(200).json({
      status: 'success',
      razorpayOrderId: payment.razorpayOrderId,
      amount: toMoney(order.grandTotal),
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || null,
      paymentUrl,
      // Without credentials `createOrder` returns a stub id no gateway knows, so
      // the page would open a checkout that cannot work. The app reads this to
      // decide whether to offer the tap at all — the same rule as the camera
      // button that is absent rather than disabled.
      gatewayReady: isLive()
    });
  } catch (error) {
    console.error('Create Razorpay Order Error:', error);
    return res.status(500).json({ message: 'Server error while creating the payment order.' });
  }
};

/**
 * GET /pay/:orderId?t=<ticket> — the hosted checkout page (2026-08-12).
 *
 * Public, and outside `/api` on purpose: this is a page for a browser, not an
 * endpoint for the app, and the ticket in the query string is its whole
 * authorisation (`lib/paymentPageToken.js`). It renders HTML in every case,
 * including every failure — a customer who has just tapped "Pay" is holding a
 * phone with money on the line, and a JSON error body or a blank screen is the
 * worst possible answer.
 *
 * ⚠️ **Nothing here can mark a payment PAID.** It reads one order, creates the
 * gateway order if the app has not already, and renders. The webhook below is
 * the only writer.
 */
export const paymentPage = async (req, res) => {
  const html = (body, status = 200) => res.status(status).type('html').send(body);

  try {
    const orderId = parseId(req.params.orderId);
    const ticketOrderId = orderIdFromPaymentPageToken(req.query?.t);

    // One check, two failures: a ticket that does not verify, and a valid ticket
    // pointed at somebody else's order. Both get the same page — telling a
    // browser which of the two it was is telling it something about an order it
    // has no right to.
    if (!orderId || ticketOrderId !== orderId) {
      return html(
        renderMessagePage({
          title: 'This payment link has expired',
          message: 'Open the order in the RoadMate app and tap Pay again to get a fresh link.',
          tone: 'bad'
        }),
        403
      );
    }

    const order = await prisma.consumerOrder.findUnique({
      where: { id: orderId },
      include: { payment: true, customer: true }
    });
    if (!order || !order.payment) {
      return html(
        renderMessagePage({ title: 'Order not found', message: 'This order no longer exists.', tone: 'bad' }),
        404
      );
    }

    const deepLink = appDeepLink(order.id);

    if (order.payment.method !== 'PREPAID') {
      return html(
        renderMessagePage({
          title: 'Nothing to pay here',
          message: 'This is a cash-on-delivery order. Pay your delivery partner at the door.',
          deepLink
        })
      );
    }

    // Not an error, and deliberately not phrased as one: the likeliest way to
    // reach this is the customer paying, coming back, and tapping the same link
    // again before the tracking screen's next poll.
    if (order.payment.status === 'PAID') {
      return html(
        renderMessagePage({
          title: 'Already paid',
          message: `Order ${order.orderNumber} is paid. You can follow it in the app.`,
          deepLink
        })
      );
    }

    if (!isLive()) {
      return html(
        renderMessagePage({
          title: 'Online payment is not set up yet',
          message: 'Cash on delivery still works. Nothing has been charged.',
          deepLink,
          tone: 'bad'
        }),
        503
      );
    }

    // The app normally creates this a moment earlier, at checkout. Doing it here
    // too means a link that outlived its request — or an order placed before the
    // gateway was configured — still opens rather than dead-ending.
    let payment = order.payment;
    if (!payment.razorpayOrderId) {
      const rpOrder = await createOrder({
        amountPaise: Math.round(Number(order.grandTotal) * 100),
        receipt: order.orderNumber
      });
      payment = await prisma.payment.update({
        where: { id: payment.id },
        data: { razorpayOrderId: rpOrder.id }
      });
    }

    return html(
      renderCheckoutPage({
        keyId: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: payment.razorpayOrderId,
        amount: toMoney(order.grandTotal),
        orderNumber: order.orderNumber,
        customer: {
          name: order.customer?.name,
          phone: order.customer?.phone,
          email: order.customer?.email
        },
        deepLink
      })
    );
  } catch (error) {
    console.error('Payment Page Error:', error);
    return html(
      renderMessagePage({
        title: 'Something went wrong',
        message: 'Your order is safe and nothing has been charged. Please try again from the app.',
        tone: 'bad'
      }),
      500
    );
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
