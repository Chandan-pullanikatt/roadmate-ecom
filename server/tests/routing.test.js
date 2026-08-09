// Phase 1.5 — the routing engine and the timeout sweeper.
//
// The sharp edge of this phase is the first test in this file: a reservation
// sits on ONE shop's shelf, so a reroute has to release shop A's `reserved` and
// take it on shop B inside a single transaction. If that ever becomes two
// statements, a reroute either double-books stock or loses it.
//
// Time is never slept on here. The sweeper takes an explicit `now`, so an
// expired accept window is expressed as "sweep as if it were two minutes from
// now" and the tests stay deterministic.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createShop, createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';
import { sweepExpiredAttempts, recoverStalledOrders } from '../src/jobs/sweepAttempts.js';

const LAT = 12.9716;
const LNG = 77.5946;

// A point ~1.1 km north — inside every shop's 5 km radius, so ranking is
// decided by distance and not by serviceability.
const NEAR = { latitude: LAT + 0.01, longitude: LNG };
const FAR = { latitude: LAT + 0.02, longitude: LNG };

/** Sweep as if the accept window had already elapsed. No sleeping. */
const later = (ms = 120_000) => new Date(Date.now() + ms);

let world;
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
  await createRider({ lastLat: LAT, lastLng: LNG });

  customer = await createCustomer();
  token = customerTokenFor(customer);
  address = await createAddress({ customerId: customer.id, latitude: LAT, longitude: LNG });

  product = await createProduct({
    name: 'Toor Dal 1kg',
    industryId: world.industry.id,
    ownerId: world.master.id
  });
});

after(async () => {
  await disconnect();
});

const as = (t) => ({
  post: (path, body) => request(app).post(path).set('Authorization', `Bearer ${t}`).send(body),
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${t}`)
});

/**
 * The world 1.5 needs: the baseline shop (nearest, so it is candidate 1) plus a
 * second shop further out, both stocked, and a placed COD order.
 */
async function placeWithBackup({ backupStock = 5, quantity = 2, paymentMethod = 'COD' } = {}) {
  const backup = await createShop({
    name: 'Backup Shop',
    industryId: world.industry.id,
    ...NEAR,
    safetyStockBuffer: 100
  });

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  const backupShelf = await stockShop({
    shopId: backup.id, productId: product.id, quantity: backupStock, sellingPrice: 110
  });

  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity
  });

  const res = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  return { backup, backupShelf, order: res.body.order, quantity };
}

const shelfAt = (shopId) => prisma.shopInventory.findFirst({ where: { shopId, productId: product.id } });
const attemptsOf = (orderId) =>
  prisma.fulfilmentAttempt.findMany({ where: { consumerOrderId: orderId }, orderBy: { sequence: 'asc' } });

// --- the sharp edge ----------------------------------------------------------

test('a reroute moves the reservation from shop A to shop B atomically', async () => {
  const { backup, order, quantity } = await placeWithBackup();

  assert.equal((await shelfAt(world.shop.id)).reserved, quantity, 'placement reserved at shop A');
  assert.equal((await shelfAt(backup.id)).reserved, 0);

  await sweepExpiredAttempts({ now: later() });

  const a = await shelfAt(world.shop.id);
  const b = await shelfAt(backup.id);
  assert.equal(a.reserved, 0, "shop A's shelf is freed the moment it loses the order");
  assert.equal(b.reserved, quantity, "shop B now holds the units");
  assert.equal(a.quantity, 10, 'a reroute never decrements — that is delivery');
  assert.equal(b.quantity, 5);

  const attempts = await attemptsOf(order.id);
  assert.deepEqual(
    attempts.map((x) => [x.sequence, x.shopId, x.status]),
    [[1, world.shop.id, 'TIMED_OUT'], [2, backup.id, 'OFFERED']]
  );
});

test('a reroute whose new shop cannot take the stock does not strand the reservation', async () => {
  // Shop B looks like a candidate when the order is placed and is emptied
  // behind the sweeper's back, so the reservation must land on shop C — never
  // nowhere.
  const { backup, backupShelf, order, quantity } = await placeWithBackup();
  const third = await createShop({
    name: 'Third Shop', industryId: world.industry.id, ...FAR, safetyStockBuffer: 100
  });
  await stockShop({ shopId: third.id, productId: product.id, quantity: 9, sellingPrice: 120 });

  await prisma.shopInventory.update({ where: { id: backupShelf.id }, data: { quantity: 0 } });

  await sweepExpiredAttempts({ now: later() });

  assert.equal((await shelfAt(world.shop.id)).reserved, 0);
  assert.equal((await shelfAt(backup.id)).reserved, 0, 'the empty shop takes nothing');
  assert.equal((await shelfAt(third.id)).reserved, quantity);

  const attempts = await attemptsOf(order.id);
  assert.equal(attempts.at(-1).shopId, third.id);
});

// --- placement opens attempt 1 ----------------------------------------------

test('placement opens FulfilmentAttempt sequence 1 at the cart shop, expiring per PlatformConfig', async () => {
  await setConfig(CONFIG_KEYS.ACCEPT_WINDOW_SECONDS, '45');

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 1 });
  const res = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });

  const [attempt] = await attemptsOf(res.body.order.id);
  assert.equal(attempt.sequence, 1);
  assert.equal(attempt.shopId, world.shop.id);
  assert.equal(attempt.status, 'OFFERED');

  const windowMs = attempt.expiresAt.getTime() - attempt.offeredAt.getTime();
  assert.equal(windowMs, 45_000, 'the accept window is read from config, never hardcoded');

  const row = await prisma.consumerOrder.findUnique({ where: { id: res.body.order.id } });
  assert.equal(row.status, 'ROUTING', 'an offered order is ROUTING, not PLACED');
  assert.equal(row.shopId, null, 'binding still only happens on accept');
});

test('a per-industry accept window overrides the global one', async () => {
  await setConfig(CONFIG_KEYS.ACCEPT_WINDOW_SECONDS, '60');
  await setConfig(CONFIG_KEYS.ACCEPT_WINDOW_SECONDS, '20', world.industry.id);

  const { order } = await placeWithBackup({ quantity: 1 });
  const [attempt] = await attemptsOf(order.id);
  assert.equal(attempt.expiresAt.getTime() - attempt.offeredAt.getTime(), 20_000);
});

test('an unpaid prepaid order is never offered to a shop', async () => {
  const { order } = await placeWithBackup({ paymentMethod: 'PREPAID' });

  const row = await prisma.consumerOrder.findUnique({ where: { id: order.id } });
  assert.equal(row.status, 'PLACED', 'PLACED means "not yet offered" — prepaid waits for the webhook');

  // The attempt row exists because it records whose shelf holds the
  // reservation, but the sweeper must not time out an order nobody was shown.
  const result = await sweepExpiredAttempts({ now: later() });
  assert.equal(result.rerouted, 0);
  assert.equal(result.skipped, 1);

  const attempts = await attemptsOf(order.id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'OFFERED');
});

// --- the sweeper -------------------------------------------------------------

test('the sweeper leaves a live offer alone', async () => {
  const { order } = await placeWithBackup();

  const result = await sweepExpiredAttempts({ now: new Date() });
  assert.equal(result.examined, 0);

  const attempts = await attemptsOf(order.id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'OFFERED');
});

test('the sweeper is idempotent — running it twice reroutes once', async () => {
  const { order } = await placeWithBackup();

  const now = later();
  const [first, second] = [await sweepExpiredAttempts({ now }), await sweepExpiredAttempts({ now })];

  assert.equal(first.rerouted, 1);
  assert.equal(second.rerouted, 0, 'the second pass finds nothing left to claim');
  assert.equal((await attemptsOf(order.id)).length, 2);
  assert.equal((await shelfAt(world.shop.id)).reserved, 0);
});

test('two sweepers racing the same expired offer reroute it exactly once', async () => {
  const { order, backup, quantity } = await placeWithBackup();

  const now = later();
  await Promise.all([sweepExpiredAttempts({ now }), sweepExpiredAttempts({ now })]);

  const attempts = await attemptsOf(order.id);
  assert.equal(attempts.length, 2, `got ${JSON.stringify(attempts.map((a) => a.sequence))}`);
  assert.equal((await shelfAt(backup.id)).reserved, quantity, 'never reserved twice');
});

test('a shop already attempted is never offered the same order again', async () => {
  const { backup, order } = await placeWithBackup();

  // Make the backup the most attractive shop there is; it still must not be
  // re-offered once it has timed out.
  await sweepExpiredAttempts({ now: later() });
  await prisma.user.update({ where: { id: backup.id }, data: { routingPriority: 100 } });
  await sweepExpiredAttempts({ now: later(240_000) });

  const shopIds = (await attemptsOf(order.id)).map((a) => a.shopId);
  assert.deepEqual(new Set(shopIds).size, shopIds.length, 'no shop appears twice');
});

test('a shop without enough stock is skipped as a reroute candidate', async () => {
  const { backup, order, quantity } = await placeWithBackup({ backupStock: 1 }); // needs 2
  const third = await createShop({
    name: 'Third Shop', industryId: world.industry.id, ...FAR, safetyStockBuffer: 100
  });
  await stockShop({ shopId: third.id, productId: product.id, quantity: 8, sellingPrice: 130 });

  await sweepExpiredAttempts({ now: later() });

  const attempts = await attemptsOf(order.id);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].shopId, third.id, 'the short shop is not even offered');
  assert.equal((await shelfAt(backup.id)).reserved, 0);
  assert.equal((await shelfAt(third.id)).reserved, quantity);
});

test('a timed-out offer costs the shop fulfilment rate, not a fine', async () => {
  await placeWithBackup();
  assert.equal((await prisma.user.findUnique({ where: { id: world.shop.id } })).fulfilmentRate, 100);

  await sweepExpiredAttempts({ now: later() });

  const shop = await prisma.user.findUnique({ where: { id: world.shop.id } });
  assert.equal(shop.fulfilmentRate, 0, '1 attempt, 0 accepted');
});

// --- exhaustion --------------------------------------------------------------

test('exhausting every candidate cancels the order and releases all stock', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 2 });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });
  const orderId = placed.body.order.id;

  const result = await sweepExpiredAttempts({ now: later() });
  assert.equal(result.cancelled, 1);

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId },
    include: { payment: true }
  });
  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.shopId, null);
  assert.ok(order.cancelledAt);
  assert.match(order.cancelReason, /shop/i);

  assert.equal((await shelfAt(world.shop.id)).reserved, 0, 'a cancelled order holds nothing');
  assert.equal((await shelfAt(world.shop.id)).quantity, 10);

  // COD was never collected, so there is nothing to refund — the payment is
  // closed as FAILED rather than left PENDING forever.
  assert.equal(order.payment.status, 'FAILED');
});

test('a prepaid order that exhausts its candidates is flagged for refund', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 1 });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'PREPAID'
  });
  const orderId = placed.body.order.id;

  // The webhook lands (§1.8's job), which is what makes the order routable.
  await prisma.payment.update({
    where: { consumerOrderId: orderId },
    data: { status: 'PAID' }
  });
  const { beginRouting } = await import('../src/lib/routing.js');
  await beginRouting(orderId);

  await sweepExpiredAttempts({ now: later() });

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { payment: true }
  });
  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.payment.status, 'REFUNDED');
  assert.equal(order.payment.refundAmount.toFixed(2), order.grandTotal.toFixed(2));
  assert.ok(order.payment.refundedAt, 'the refund is owed the moment the order dies');
});

test('the customer can see the reroute history on their order', async () => {
  const { backup, order } = await placeWithBackup();
  await sweepExpiredAttempts({ now: later() });

  const res = await as(token).get(`/api/customer/orders/${order.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.order.status, 'ROUTING');
  assert.equal(res.body.order.shop, null, 'no shop is named until one accepts');
  assert.equal(res.body.order.attempts.length, 2);
  assert.equal(res.body.order.attempts[1].shopId, backup.id);
});

// --- crash recovery ----------------------------------------------------------

test('an order stalled mid-reroute is picked back up', async () => {
  // Simulates a process dying between closing one attempt and opening the
  // next: ROUTING, no live offer, nobody coming. Without this pass the order
  // sits forever with stock held.
  const { backup, order, quantity } = await placeWithBackup();

  await prisma.fulfilmentAttempt.updateMany({
    where: { consumerOrderId: order.id },
    data: { status: 'TIMED_OUT', respondedAt: new Date() }
  });

  const result = await recoverStalledOrders({ now: later(), staleAfterSeconds: 1 });
  assert.equal(result.rerouted, 1);

  const attempts = await attemptsOf(order.id);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].shopId, backup.id);
  assert.equal(attempts[1].status, 'OFFERED');
  assert.equal((await shelfAt(backup.id)).reserved, quantity);
});

test('recovery ignores an order that still has a live offer', async () => {
  await placeWithBackup();
  const result = await recoverStalledOrders({ now: later(), staleAfterSeconds: 1 });
  assert.equal(result.examined, 0);
});
