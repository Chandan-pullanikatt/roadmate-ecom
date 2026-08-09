// Phase 1.8 — money.
//
// Four things this file exists to pin down:
//   · The webhook signature is the only authority on a PREPAID payment. An
//     unsigned or wrongly-signed request cannot move a paisa, and an unpaid
//     prepaid order is never offered to a shop.
//   · The commission split comes from `PlatformConfig.commission_percent` and
//     is frozen at delivery — changing the config afterwards must not rewrite
//     history.
//   · COD cash is tracked from the customer's hand to the platform's, and
//     remitting is a claim, so it cannot double-count.
//   · The weekly settlement run is re-runnable without paying anyone twice.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createShop, createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';
import { runSettlement, commissionSplit } from '../src/lib/settlement.js';

const LAT = 12.9716;
const LNG = 77.5946;

let world;
let shopToken;
let master;
let masterToken;
let rider;
let riderToken;
let customer;
let token;
let address;
let product;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  await prisma.user.update({ where: { id: world.shop.id }, data: { safetyStockBuffer: 100 } });
  shopToken = tokenFor(world.shop);
  master = world.master;
  masterToken = tokenFor(master);

  rider = await createRider({ lastLat: LAT, lastLng: LNG });
  riderToken = tokenFor(rider);

  customer = await createCustomer();
  token = customerTokenFor(customer);
  address = await createAddress({ customerId: customer.id, latitude: LAT, longitude: LNG });
  product = await createProduct({
    name: 'Toor Dal 1kg', industryId: world.industry.id, ownerId: world.master.id
  });
});

after(async () => {
  await disconnect();
});

const as = (t) => ({
  post: (path, body) => request(app).post(path).set('Authorization', `Bearer ${t}`).send(body),
  patch: (path, body) => request(app).patch(path).set('Authorization', `Bearer ${t}`).send(body),
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${t}`)
});

/** Place an order and return its id. Stocks the shelf on the way through. */
async function place({ paymentMethod = 'COD', quantity = 2, sellingPrice = 100 } = {}) {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice });
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity
  });
  const res = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.order.id;
}

/** Placed → accepted → packed → READY → picked → delivered. */
async function deliverOrder(orderId) {
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });

  const job = await prisma.deliveryJob.findFirst({ where: { consumerOrderId: orderId } });
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  const res = await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return job;
}

/** A webhook request signed exactly the way Razorpay signs one. */
function webhook(payload, { secret = process.env.RAZORPAY_WEBHOOK_SECRET, signature } = {}) {
  const body = JSON.stringify(payload);
  const sig = signature ?? crypto.createHmac('sha256', secret).update(body).digest('hex');
  return request(app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', sig)
    .send(body);
}

const captured = (razorpayOrderId, paymentId = 'pay_TEST123') => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId } } }
});

// --- Razorpay checkout order --------------------------------------------------

test('a prepaid order gets a Razorpay order, and asking twice returns the same one', async () => {
  const orderId = await place({ paymentMethod: 'PREPAID' });

  const first = await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.razorpayOrderId);
  assert.equal(first.body.amount, '200.00');
  assert.equal(first.body.currency, 'INR');

  const second = await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`);
  // Two gateway orders for one payment would leave the first one uncompletable.
  assert.equal(second.body.razorpayOrderId, first.body.razorpayOrderId);
});

test('a COD order has nothing to pay through Razorpay', async () => {
  const orderId = await place({ paymentMethod: 'COD' });
  const res = await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`);
  assert.equal(res.status, 400);
});

test("a customer cannot open a payment on someone else's order", async () => {
  const orderId = await place({ paymentMethod: 'PREPAID' });
  const stranger = customerTokenFor(await createCustomer());

  const res = await as(stranger).post(`/api/customer/orders/${orderId}/razorpay-order`);
  assert.equal(res.status, 404);
});

// --- the webhook --------------------------------------------------------------

test('an unsigned or wrongly-signed webhook cannot mark anything paid', async () => {
  const orderId = await place({ paymentMethod: 'PREPAID' });
  const rp = (await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`)).body.razorpayOrderId;

  const unsigned = await request(app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(captured(rp)));
  assert.equal(unsigned.status, 400);

  const wrong = await webhook(captured(rp), { secret: 'not-the-secret' });
  assert.equal(wrong.status, 400);

  // The client's own word is worth nothing; the order is still unpaid and
  // still not offered to anybody.
  const payment = await prisma.payment.findFirst({ where: { consumerOrderId: orderId } });
  assert.equal(payment.status, 'PENDING');
  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });
  assert.equal(order.status, 'PLACED');
});

test('a signed webhook marks the payment PAID and starts the accept window', async () => {
  const orderId = await place({ paymentMethod: 'PREPAID' });
  const rp = (await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`)).body.razorpayOrderId;

  // Before the money lands, the shop's inbox does not show it (§1.5).
  const before = await as(shopToken).get('/api/shop/offers');
  assert.equal(before.body.offers.length, 0, 'an unpaid prepaid order is never offered');

  const res = await webhook(captured(rp));
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const payment = await prisma.payment.findFirst({ where: { consumerOrderId: orderId } });
  assert.equal(payment.status, 'PAID');
  assert.equal(payment.razorpayPaymentId, 'pay_TEST123');

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { attempts: true }
  });
  assert.equal(order.status, 'ROUTING');
  assert.equal(order.attempts[0].status, 'OFFERED');
  assert.ok(order.attempts[0].expiresAt > new Date(), 'the window starts when the money lands');

  const after = await as(shopToken).get('/api/shop/offers');
  assert.equal(after.body.offers.length, 1);
});

test('a replayed webhook is a no-op, not a second routing run', async () => {
  const orderId = await place({ paymentMethod: 'PREPAID' });
  const rp = (await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`)).body.razorpayOrderId;

  await webhook(captured(rp));
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);

  // Razorpay retries. This must not drag an accepted order back to ROUTING.
  const replay = await webhook(captured(rp));
  assert.equal(replay.status, 200);

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { attempts: true }
  });
  assert.equal(order.status, 'ACCEPTED');
  assert.equal(order.attempts.length, 1, 'no second attempt was opened');
});

test('an event we do not act on is acknowledged, not retried forever', async () => {
  const res = await webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } } });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ignored');
});

// --- the commission split -----------------------------------------------------

test('commissionSplit always sums back to the total, to the paisa', async () => {
  for (const [total, percent, expected] of [
    ['100.00', 15, '15.00'],
    ['199.99', 15, '30.00'],
    ['0.01', 15, '0.00'],
    ['333.33', 7.5, '25.00']
  ]) {
    const { platformCommission, shopPayable } = commissionSplit(total, percent);
    assert.equal(platformCommission.toFixed(2), expected, `${total} @ ${percent}%`);
    assert.equal(
      platformCommission.plus(shopPayable).toFixed(2),
      Number(total).toFixed(2),
      'the split must not lose or invent money'
    );
  }
});

test('delivery freezes the split from PlatformConfig, not from a constant', async () => {
  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, '12');

  const orderId = await place({ quantity: 2, sellingPrice: 100 });
  await deliverOrder(orderId);

  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });
  assert.equal(order.platformCommission.toFixed(2), '24.00');
  assert.equal(order.shopPayable.toFixed(2), '176.00');
});

test('a per-industry commission override beats the global row', async () => {
  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, '10');
  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, '20', world.industry.id);

  const orderId = await place({ quantity: 1, sellingPrice: 100 });
  await deliverOrder(orderId);

  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });
  assert.equal(order.platformCommission.toFixed(2), '20.00');
});

test('changing the commission later does not rewrite a delivered order', async () => {
  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, '15');
  const orderId = await place({ quantity: 1, sellingPrice: 100 });
  await deliverOrder(orderId);

  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, '30');

  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });
  assert.equal(order.platformCommission.toFixed(2), '15.00', 'history is frozen at delivery');
});

// --- COD cash-in-hand ---------------------------------------------------------

test('a delivered COD order shows up as cash the rider is holding', async () => {
  const orderId = await place({ quantity: 2, sellingPrice: 100 });
  await deliverOrder(orderId);

  const summary = await as(riderToken).get('/api/rider/remittance');
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.count, 1);
  assert.equal(summary.body.totalHeld, '200.00');
  assert.equal(summary.body.payments[0].consumerOrderId, orderId);
});

test('a prepaid delivery leaves the rider holding nothing', async () => {
  const orderId = await place({ paymentMethod: 'PREPAID', quantity: 1, sellingPrice: 100 });
  const rp = (await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`)).body.razorpayOrderId;
  await webhook(captured(rp));
  await deliverOrder(orderId);

  const summary = await as(riderToken).get('/api/rider/remittance');
  assert.equal(summary.body.count, 0);
  assert.equal(summary.body.totalHeld, '0.00');

  const payment = await prisma.payment.findFirst({ where: { consumerOrderId: orderId } });
  assert.equal(payment.collectedByRiderId, null, 'no cash changed hands at the door');
});

test('remitting closes the loop, and remitting twice does not double-count', async () => {
  await deliverOrder(await place({ quantity: 1, sellingPrice: 100 }));

  const first = await as(riderToken).post('/api/rider/remittance');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.count, 1);
  assert.equal(first.body.totalRemitted, '100.00');

  const payment = await prisma.payment.findFirst({ where: { collectedByRiderId: rider.id } });
  assert.ok(payment.cashRemittedAt, 'the platform has the money now');

  const again = await as(riderToken).post('/api/rider/remittance');
  assert.equal(again.body.count, 0);
  assert.equal(again.body.totalRemitted, '0.00');

  assert.equal((await as(riderToken).get('/api/rider/remittance')).body.count, 0);
});

test('cash collected after a remittance is a fresh balance, not a reopened one', async () => {
  await deliverOrder(await place({ quantity: 1, sellingPrice: 100 }));
  await as(riderToken).post('/api/rider/remittance');

  await deliverOrder(await place({ quantity: 3, sellingPrice: 100 }));

  const summary = await as(riderToken).get('/api/rider/remittance');
  assert.equal(summary.body.count, 1);
  assert.equal(summary.body.totalHeld, '300.00');
});

test('the finance view totals unremitted cash across riders, and is MASTER-only', async () => {
  await deliverOrder(await place({ quantity: 2, sellingPrice: 100 }));

  const forbidden = await as(shopToken).get('/api/finance/cod-outstanding');
  assert.equal(forbidden.status, 403);

  const res = await as(masterToken).get('/api/finance/cod-outstanding');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.grandTotal, '200.00');
  assert.equal(res.body.riders.length, 1);
  assert.equal(res.body.riders[0].riderId, rider.id);
  assert.equal(res.body.riders[0].totalHeld, '200.00');
  assert.ok(res.body.riders[0].oldestCollectedAt);

  await as(riderToken).post('/api/rider/remittance');
  const after = await as(masterToken).get('/api/finance/cod-outstanding');
  assert.equal(after.body.grandTotal, '0.00');
  assert.equal(after.body.riders.length, 0);
});

// --- the weekly settlement run ------------------------------------------------

const WEEK = { periodStart: new Date('2026-08-03T00:00:00Z'), periodEnd: new Date('2026-08-10T00:00:00Z') };

/** Move a delivered order's `deliveredAt` into the settlement window. */
const backdate = (orderId, at = new Date('2026-08-05T10:00:00Z')) =>
  prisma.consumerOrder.update({ where: { id: orderId }, data: { deliveredAt: at } });

test('settlement accrues one Settlement per shop with a line per order', async () => {
  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, '15');

  const first = await place({ quantity: 2, sellingPrice: 100 });
  await deliverOrder(first);
  await backdate(first);

  const second = await place({ quantity: 1, sellingPrice: 100 });
  await deliverOrder(second);
  await backdate(second);

  const result = await runSettlement(WEEK);
  assert.equal(result.shopCount, 1);

  const settlement = await prisma.settlement.findFirst({
    where: { shopId: world.shop.id }, include: { lines: true }
  });
  assert.equal(settlement.lines.length, 2);
  assert.equal(settlement.grossSales.toFixed(2), '300.00');
  assert.equal(settlement.commission.toFixed(2), '45.00');
  assert.equal(settlement.netPayable.toFixed(2), '255.00');
  // Both orders were COD, so the platform's share is money the rider collected
  // on its behalf — that is what makes the remittance loop above matter.
  assert.equal(settlement.codCollected.toFixed(2), '300.00');
  assert.equal(settlement.deductions.toFixed(2), '0.00', 'no shop deductions in year one');
  assert.equal(settlement.status, 'OPEN');
});

test('re-running settlement pays nobody twice', async () => {
  const orderId = await place({ quantity: 1, sellingPrice: 100 });
  await deliverOrder(orderId);
  await backdate(orderId);

  await runSettlement(WEEK);
  const second = await runSettlement(WEEK);

  assert.equal(second.shopCount, 0, 'the second run finds nothing left to settle');
  assert.equal(await prisma.settlement.count(), 1);
  assert.equal(await prisma.settlementLine.count(), 1);
});

test('settlement ignores orders outside the window and orders never delivered', async () => {
  const inside = await place({ quantity: 1, sellingPrice: 100 });
  await deliverOrder(inside);
  await backdate(inside);

  const outside = await place({ quantity: 1, sellingPrice: 100 });
  await deliverOrder(outside);
  await backdate(outside, new Date('2026-07-20T10:00:00Z'));

  // Placed and accepted, but never delivered — nothing is owed on it yet.
  const undelivered = await place({ quantity: 1, sellingPrice: 100 });
  await as(shopToken).post(`/api/shop/offers/${undelivered}/accept`);

  await runSettlement(WEEK);

  const lines = await prisma.settlementLine.findMany();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].consumerOrderId, inside);
});

test('two shops settle separately', async () => {
  const other = await createShop({
    name: 'Second Shop', industryId: world.industry.id, latitude: LAT + 0.005, longitude: LNG
  });
  await stockShop({ shopId: other.id, productId: product.id, quantity: 10, sellingPrice: 50 });

  const mine = await place({ quantity: 1, sellingPrice: 100 });
  await deliverOrder(mine);
  await backdate(mine);

  // The second shop's order, walked through the same lifecycle with its own token.
  const otherShopToken = tokenFor(other);
  await as(token).post('/api/customer/cart/items', {
    shopId: other.id, productId: product.id, quantity: 2
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: other.id, addressId: address.id, paymentMethod: 'COD'
  });
  const otherOrderId = placed.body.order.id;
  await as(otherShopToken).post(`/api/shop/offers/${otherOrderId}/accept`);
  await as(otherShopToken).patch(`/api/shop/orders/${otherOrderId}/status`, { status: 'PREPARING' });
  await as(otherShopToken).patch(`/api/shop/orders/${otherOrderId}/status`, { status: 'READY' });
  const job = await prisma.deliveryJob.findFirst({ where: { consumerOrderId: otherOrderId } });
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode });
  await backdate(otherOrderId);

  const result = await runSettlement(WEEK);
  assert.equal(result.shopCount, 2);

  const settlements = await prisma.settlement.findMany({ orderBy: { shopId: 'asc' } });
  const byShop = new Map(settlements.map((s) => [s.shopId, s]));
  assert.equal(byShop.get(world.shop.id).grossSales.toFixed(2), '100.00');
  assert.equal(byShop.get(other.id).grossSales.toFixed(2), '100.00');
});

// --- refunds ------------------------------------------------------------------

test('a paid prepaid order with no shop left is closed as refundable', async () => {
  const orderId = await place({ paymentMethod: 'PREPAID', quantity: 1, sellingPrice: 100 });
  const rp = (await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`)).body.razorpayOrderId;
  await webhook(captured(rp));

  // The only shop rejects; there is nowhere else to go.
  const res = await as(shopToken).post(`/api/shop/offers/${orderId}/reject`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { payment: true }
  });
  assert.equal(order.status, 'CANCELLED');
  // The debt is recorded the moment it exists, whether or not the gateway call
  // (fired and forgotten in `closePaymentAsRefundable`) succeeds.
  assert.equal(order.payment.status, 'REFUNDED');
  assert.equal(order.payment.refundAmount.toFixed(2), '100.00');
  assert.ok(order.payment.refundedAt);
});
