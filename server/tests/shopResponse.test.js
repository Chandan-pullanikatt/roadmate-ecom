// Phase 1.6 — the shop's side of the offer.
//
// Accept binds the order. Reject and stockout both hand it to the next shop
// through the same `advanceOrder` the sweeper uses, so there is one reroute
// implementation and not three.
//
// The accept race matters as much as the placement race did: a shop tapping
// "accept" at the same instant the window closes must either win cleanly or lose
// cleanly. Both outcomes are tested.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createShop, createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';
import { sweepExpiredAttempts } from '../src/jobs/sweepAttempts.js';

const LAT = 12.9716;
const LNG = 77.5946;
const NEAR = { latitude: LAT + 0.01, longitude: LNG };

let world;
let shopToken;
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
  await createRider({ lastLat: LAT, lastLng: LNG });

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

/** Cart + checkout at the baseline shop. Assumes the shelf is already stocked. */
async function cartAndPlace(quantity = 2) {
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity
  });
  const res = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.order.id;
}

/** Place a COD order, offered to the baseline shop as attempt 1. */
async function placeOrder({ quantity = 2, withBackup = false } = {}) {
  let backup = null;
  if (withBackup) {
    backup = await createShop({
      name: 'Backup Shop', industryId: world.industry.id, ...NEAR, safetyStockBuffer: 100
    });
    await stockShop({ shopId: backup.id, productId: product.id, quantity: 10, sellingPrice: 110 });
  }

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  return { orderId: await cartAndPlace(quantity), backup, quantity };
}

const shelfAt = (shopId) => prisma.shopInventory.findFirst({ where: { shopId, productId: product.id } });
const orderRow = (id) => prisma.consumerOrder.findUnique({ where: { id }, include: { attempts: true } });

// --- the offer inbox ---------------------------------------------------------

test('a shop sees its live offer with the time it has left', async () => {
  await setConfig(CONFIG_KEYS.ACCEPT_WINDOW_SECONDS, '60');
  const { orderId } = await placeOrder();

  const res = await as(shopToken).get('/api/shop/offers');
  assert.equal(res.status, 200);
  assert.equal(res.body.offers.length, 1);

  const offer = res.body.offers[0];
  assert.equal(offer.orderId, orderId);
  assert.equal(offer.sequence, 1);
  assert.ok(offer.secondsRemaining > 50 && offer.secondsRemaining <= 60, `got ${offer.secondsRemaining}`);
  assert.equal(offer.items.length, 1);
  assert.equal(offer.items[0].productName, 'Toor Dal 1kg');
  assert.equal(offer.grandTotal, '200.00');
});

test('an expired offer is not in the inbox and cannot be accepted', async () => {
  await setConfig(CONFIG_KEYS.ACCEPT_WINDOW_SECONDS, '0');
  const { orderId } = await placeOrder();

  const inbox = await as(shopToken).get('/api/shop/offers');
  assert.equal(inbox.body.offers.length, 0);

  const res = await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal((await orderRow(orderId)).shopId, null, 'a late accept must never bind the order');
});

test('one shop cannot see or accept another shop\'s offer', async () => {
  const { orderId, backup } = await placeOrder({ withBackup: true });
  const backupToken = tokenFor(backup);

  assert.deepEqual((await as(backupToken).get('/api/shop/offers')).body.offers, []);
  assert.equal((await as(backupToken).post(`/api/shop/offers/${orderId}/accept`)).status, 404);
});

test('the shop endpoints are closed to customers and to other roles', async () => {
  const { orderId } = await placeOrder();

  assert.equal((await as(token).get('/api/shop/offers')).status, 401, 'a customer token is not staff');
  assert.equal(
    (await as(tokenFor(world.master)).post(`/api/shop/offers/${orderId}/accept`)).status,
    403
  );
});

// --- accept ------------------------------------------------------------------

test('accepting binds the order to the shop and keeps the reservation', async () => {
  const { orderId, quantity } = await placeOrder();

  const res = await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.order.status, 'ACCEPTED');

  const order = await orderRow(orderId);
  assert.equal(order.status, 'ACCEPTED');
  assert.equal(order.shopId, world.shop.id, 'accept is what binds a shop to an order');
  assert.ok(order.acceptedAt);
  assert.equal(order.attempts[0].status, 'ACCEPTED');
  assert.ok(order.attempts[0].respondedAt);

  const shelf = await shelfAt(world.shop.id);
  assert.equal(shelf.reserved, quantity, 'the reservation stays held — it is committed, not re-taken');
  assert.equal(shelf.quantity, 10, 'quantity still only drops at delivery');
});

test('accepting twice is not an error the second time it is a no-op', async () => {
  const { orderId } = await placeOrder();

  const [a, b] = await Promise.all([
    as(shopToken).post(`/api/shop/offers/${orderId}/accept`),
    as(shopToken).post(`/api/shop/offers/${orderId}/accept`)
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], `got ${JSON.stringify([a.body, b.body])}`);
  assert.equal(await prisma.fulfilmentAttempt.count({ where: { status: 'ACCEPTED' } }), 1);
});

test('a shop that accepts cannot be beaten by the sweeper', async () => {
  const { orderId, quantity } = await placeOrder({ withBackup: true });

  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  // The window elapses a moment after the accept lands. The sweeper must not
  // yank an order out from under a shop that already owns it.
  await sweepExpiredAttempts({ now: new Date(Date.now() + 120_000) });

  const order = await orderRow(orderId);
  assert.equal(order.status, 'ACCEPTED');
  assert.equal(order.shopId, world.shop.id);
  assert.equal(order.attempts.length, 1, 'no second offer was opened');
  assert.equal((await shelfAt(world.shop.id)).reserved, quantity);
});

test('accepting lifts the shop\'s fulfilment rate', async () => {
  const { orderId } = await placeOrder();
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);

  const shop = await prisma.user.findUnique({ where: { id: world.shop.id } });
  assert.equal(shop.fulfilmentRate, 100);
});

// --- reject ------------------------------------------------------------------

test('rejecting releases the stock and offers the order to the next shop at once', async () => {
  const { orderId, backup, quantity } = await placeOrder({ withBackup: true });

  const res = await as(shopToken).post(`/api/shop/offers/${orderId}/reject`, { reason: 'Too busy' });
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'REROUTED');

  const order = await orderRow(orderId);
  assert.equal(order.status, 'ROUTING');
  assert.equal(order.shopId, null);
  assert.deepEqual(
    order.attempts.sort((a, b) => a.sequence - b.sequence).map((a) => [a.shopId, a.status]),
    [[world.shop.id, 'REJECTED'], [backup.id, 'OFFERED']]
  );
  assert.equal(order.attempts.find((a) => a.status === 'REJECTED').reason, 'Too busy');

  assert.equal((await shelfAt(world.shop.id)).reserved, 0, 'a rejecting shop holds nothing');
  assert.equal((await shelfAt(backup.id)).reserved, quantity);
});

test('rejecting the last available shop cancels the order', async () => {
  const { orderId } = await placeOrder();

  const res = await as(shopToken).post(`/api/shop/offers/${orderId}/reject`);
  assert.equal(res.body.outcome, 'CANCELLED');

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { payment: true }
  });
  assert.equal(order.status, 'CANCELLED');
  assert.equal((await shelfAt(world.shop.id)).reserved, 0);
  assert.equal(order.payment.status, 'FAILED');
});

test('a rejected offer costs fulfilment rate', async () => {
  const { orderId } = await placeOrder();
  await as(shopToken).post(`/api/shop/offers/${orderId}/reject`);

  const shop = await prisma.user.findUnique({ where: { id: world.shop.id } });
  assert.equal(shop.fulfilmentRate, 0);
});

// --- lifecycle ---------------------------------------------------------------

test('the shop walks the order ACCEPTED → PREPARING → READY', async () => {
  const { orderId } = await placeOrder();
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);

  const preparing = await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  assert.equal(preparing.status, 200);
  assert.equal(preparing.body.order.status, 'PREPARING');

  const ready = await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });
  assert.equal(ready.status, 200);
  assert.equal((await orderRow(orderId)).status, 'READY');
});

test('the lifecycle cannot be skipped or run backwards', async () => {
  const { orderId } = await placeOrder();
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);

  // ACCEPTED → READY skips packing.
  assert.equal((await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' })).status, 409);

  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  assert.equal(
    (await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'ACCEPTED' })).status,
    400
  );
  // DELIVERED belongs to the rider, never the shop.
  assert.equal(
    (await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'DELIVERED' })).status,
    400
  );
});

test('a shop only sees and moves its own orders', async () => {
  const { orderId, backup } = await placeOrder({ withBackup: true });
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);

  const mine = await as(shopToken).get('/api/shop/orders');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.orders.map((o) => o.id), [orderId]);

  const theirs = await as(tokenFor(backup)).get('/api/shop/orders');
  assert.deepEqual(theirs.body.orders, []);
  assert.equal(
    (await as(tokenFor(backup)).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' })).status,
    404
  );
});

// --- stockout after accepting ------------------------------------------------

test('a stockout after accepting reroutes the order and releases the shelf', async () => {
  const { orderId, backup, quantity } = await placeOrder({ withBackup: true });
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });

  const res = await as(shopToken).post(`/api/shop/orders/${orderId}/stockout`, {
    reason: 'Last packet was damaged'
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, 'REROUTED');

  const order = await orderRow(orderId);
  assert.equal(order.status, 'ROUTING');
  assert.equal(order.shopId, null, 'the order is unbound again');
  assert.equal(order.acceptedAt, null);
  assert.equal(order.attempts.find((a) => a.shopId === world.shop.id).status, 'STOCKOUT');
  assert.equal(order.attempts.find((a) => a.shopId === backup.id).status, 'OFFERED');

  assert.equal((await shelfAt(world.shop.id)).reserved, 0);
  assert.equal((await shelfAt(backup.id)).reserved, quantity);
});

test('a stockout counts against the SKU, and three in a row hide it', async () => {
  await setConfig(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, '3');

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });

  for (const expected of [1, 2, 3]) {
    const orderId = await cartAndPlace(1);
    await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
    await as(shopToken).post(`/api/shop/orders/${orderId}/stockout`);

    const shelf = await shelfAt(world.shop.id);
    assert.equal(shelf.consecutiveStockouts, expected, `round ${expected}`);
    assert.equal(
      shelf.isAvailable,
      expected < 3,
      `after ${expected} stockout(s) the SKU should be ${expected < 3 ? 'listed' : 'hidden'}`
    );
  }

  // Hidden means unsellable: the customer cannot even add it to a cart again
  // until the shop re-confirms the count.
  const add = await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 1
  });
  assert.ok(add.status >= 400, `a hidden SKU must not be addable (got ${add.status})`);
});

test('a stockout cannot be claimed before the shop has accepted', async () => {
  const { orderId } = await placeOrder();
  const res = await as(shopToken).post(`/api/shop/orders/${orderId}/stockout`);
  assert.equal(res.status, 404, 'there is no accepted order to be short on');
});

test('a stockout costs more fulfilment rate than a plain reject', async () => {
  const { orderId } = await placeOrder();
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  assert.equal((await prisma.user.findUnique({ where: { id: world.shop.id } })).fulfilmentRate, 100);

  await as(shopToken).post(`/api/shop/orders/${orderId}/stockout`);

  // The ACCEPTED attempt became STOCKOUT: an accept it could not honour counts
  // as a miss, not as a success.
  assert.equal((await prisma.user.findUnique({ where: { id: world.shop.id } })).fulfilmentRate, 0);
});
