// Phase 1.7 — the last mile, and the end of the pipeline.
//
// The last test in this file is PLAN §2's exit criterion for Phase 1: one order
// walks from placement through a timeout on shop A, a reroute to shop B, an
// accept, packing, assignment, pickup and delivery — with the stock correct at
// every step. Everything above it is one link of that chain in isolation.
//
// Two invariants this file exists to pin down:
//   · `quantity` drops exactly once, at delivery, and `reserved` comes back down
//     with it. Every earlier step only moved `reserved`.
//   · A delivery without the customer's OTP does not happen.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createShop, createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';
import { sweepExpiredAttempts } from '../src/jobs/sweepAttempts.js';

const LAT = 12.9716;
const LNG = 77.5946;
const NEAR = { latitude: LAT + 0.01, longitude: LNG };

let world;
let shopToken;
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

const shelfAt = (shopId) => prisma.shopInventory.findFirst({ where: { shopId, productId: product.id } });

/** Placed → accepted → packed → READY, which is what triggers assignment. */
async function orderReadyForPickup({ quantity = 2 } = {}) {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });
  const orderId = placed.body.order.id;

  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  const ready = await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });
  assert.equal(ready.status, 200, JSON.stringify(ready.body));

  const job = await prisma.deliveryJob.findFirst({ where: { consumerOrderId: orderId } });
  return { orderId, job, quantity, assignment: ready.body.delivery };
}

// --- shift + location --------------------------------------------------------

test('a shift toggle writes RiderShift and User.isOnShift, and is idempotent', async () => {
  await prisma.user.update({ where: { id: rider.id }, data: { isOnShift: false } });

  const on = await as(riderToken).post('/api/rider/shift', { isOnShift: true, zoneNote: 'North loop' });
  assert.equal(on.status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: rider.id } })).isOnShift, true);

  await as(riderToken).post('/api/rider/shift', { isOnShift: true });
  const open = await prisma.riderShift.findMany({ where: { riderId: rider.id, endedAt: null } });
  assert.equal(open.length, 1, 'tapping on twice must not open a second shift');
  assert.equal(open[0].zoneNote, 'North loop');

  const off = await as(riderToken).post('/api/rider/shift', { isOnShift: false });
  assert.equal(off.status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: rider.id } })).isOnShift, false);
  assert.ok((await prisma.riderShift.findFirst({ where: { riderId: rider.id } })).endedAt);
});

test('a rider carrying an order cannot go off shift', async () => {
  await orderReadyForPickup();

  const res = await as(riderToken).post('/api/rider/shift', { isOnShift: false });
  assert.equal(res.status, 409);
  assert.equal((await prisma.user.findUnique({ where: { id: rider.id } })).isOnShift, true);
});

test('a location update overwrites the last position rather than appending', async () => {
  const res = await as(riderToken).post('/api/rider/location', { latitude: 12.98, longitude: 77.6 });
  assert.equal(res.status, 200);

  const row = await prisma.user.findUnique({ where: { id: rider.id } });
  assert.equal(row.lastLat, 12.98);
  assert.equal(row.lastLng, 77.6);
  assert.ok(row.lastLocationAt);

  assert.equal((await as(riderToken).post('/api/rider/location', { latitude: 999 })).status, 400);
});

test('the rider endpoints are closed to shops and to listing executives', async () => {
  assert.equal((await as(shopToken).get('/api/rider/jobs')).status, 403);

  const lister = await prisma.user.create({
    data: {
      email: 'lister@test.roadmate', password: 'x', name: 'Lister',
      role: 'EXECUTIVE', executiveType: 'LISTING', isActive: true
    }
  });
  assert.equal((await as(tokenFor(lister)).get('/api/rider/jobs')).status, 403);
});

// --- assignment --------------------------------------------------------------

test('marking an order READY creates a LAST_MILE job and assigns the nearest free rider', async () => {
  const { orderId, job, assignment } = await orderReadyForPickup();

  assert.equal(assignment.assigned, true);
  assert.equal(job.type, 'LAST_MILE');
  assert.equal(job.status, 'ASSIGNED');
  assert.equal(job.riderId, rider.id);
  assert.ok(job.assignedAt);
  assert.ok(job.otpCode && /^\d{4}$/.test(job.otpCode), 'the door handshake is generated up front');
  assert.equal(job.pickupLat, world.shop.latitude, 'pickup is the shop');
  assert.equal(job.dropLat, address.latitude, 'drop is the delivery address');

  const jobs = await as(riderToken).get('/api/rider/jobs');
  assert.equal(jobs.body.jobs.length, 1);
  assert.equal(jobs.body.jobs[0].order.id, orderId);
  assert.equal(jobs.body.jobs[0].order.collectAmount, '200.00', 'a COD rider must know what to collect');
});

test('the nearest free rider wins, and a busy rider is skipped', async () => {
  const near = await createRider({ name: 'Near', lastLat: LAT, lastLng: LNG });
  const far = await createRider({ name: 'Far', lastLat: LAT + 0.05, lastLng: LNG });

  // Both the baseline rider and `near` sit on the shop; occupy them.
  for (const busy of [rider, near]) {
    await prisma.deliveryJob.create({
      data: { type: 'LAST_MILE', status: 'EN_ROUTE_DROP', riderId: busy.id }
    });
  }

  const { job } = await orderReadyForPickup();
  assert.equal(job.riderId, far.id, 'the only free rider takes it, however far');
});

test('two orders going READY together never land on the same rider', async () => {
  // One rider, two orders. The second job has to stay unassigned rather than
  // double-booking the only person available.
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 20, sellingPrice: 100 });

  const orderIds = [];
  for (const _ of [1, 2]) {
    const second = await createCustomer();
    const secondToken = customerTokenFor(second);
    const secondAddress = await createAddress({
      customerId: second.id, latitude: LAT, longitude: LNG
    });
    await as(secondToken).post('/api/customer/cart/items', {
      shopId: world.shop.id, productId: product.id, quantity: 1
    });
    const placed = await as(secondToken).post('/api/customer/orders', {
      shopId: world.shop.id, addressId: secondAddress.id, paymentMethod: 'COD'
    });
    const id = placed.body.order.id;
    await as(shopToken).post(`/api/shop/offers/${id}/accept`);
    await as(shopToken).patch(`/api/shop/orders/${id}/status`, { status: 'PREPARING' });
    orderIds.push(id);
  }

  await Promise.all(
    orderIds.map((id) => as(shopToken).patch(`/api/shop/orders/${id}/status`, { status: 'READY' }))
  );

  const jobs = await prisma.deliveryJob.findMany({ where: { consumerOrderId: { in: orderIds } } });
  assert.equal(jobs.length, 2);
  assert.equal(jobs.filter((j) => j.riderId === rider.id).length, 1, 'the rider holds exactly one job');
  assert.equal(jobs.filter((j) => j.status === 'UNASSIGNED').length, 1, 'the other waits for a rider');
});

test('an order that goes READY with nobody on shift is picked up when a rider clocks in', async () => {
  // The rider has to be on shift to *place* the order at all — serviceability is
  // "shop in range AND a rider on shift" (§1.2). They clock off mid-order, which
  // is the realistic version of this: the shift ended while the shop packed.
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 1 });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });
  const orderId = placed.body.order.id;
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });

  await prisma.user.update({ where: { id: rider.id }, data: { isOnShift: false } });

  const ready = await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });
  const job = await prisma.deliveryJob.findFirst({ where: { consumerOrderId: orderId } });
  const assignment = ready.body.delivery;

  assert.equal(assignment.assigned, false);
  assert.equal(assignment.reason, 'NO_RIDER');
  assert.equal(job.status, 'UNASSIGNED', 'an unassigned job is a queue, not a failure');

  const on = await as(riderToken).post('/api/rider/shift', { isOnShift: true });
  assert.equal(on.body.jobsAssigned, 1);

  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(fresh.riderId, rider.id);
  assert.equal(fresh.status, 'ASSIGNED');
});

test('marking READY twice does not create a second job', async () => {
  const { orderId } = await orderReadyForPickup();
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' }); // 409, no-op

  assert.equal(await prisma.deliveryJob.count({ where: { consumerOrderId: orderId } }), 1);
});

// --- pickup + delivery -------------------------------------------------------

test('pickup moves the order to PICKED and cannot happen before the shop is READY', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 1 });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });
  const orderId = placed.body.order.id;
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);

  // Assign a job by hand, as though the shop had gone READY and back.
  const job = await prisma.deliveryJob.create({
    data: {
      type: 'LAST_MILE', status: 'ASSIGNED', riderId: rider.id,
      consumerOrderId: orderId, otpCode: '1234', assignedAt: new Date()
    }
  });

  const early = await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  assert.equal(early.status, 409, 'nothing is packed yet');

  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });

  const res = await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.job.status, 'EN_ROUTE_DROP');
  assert.equal((await prisma.consumerOrder.findUnique({ where: { id: orderId } })).status, 'PICKED');
});

test('a delivery without the right OTP does not happen', async () => {
  const { job, quantity } = await orderReadyForPickup();
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);

  for (const body of [{}, { otpCode: '' }, { otpCode: '0000' === job.otpCode ? '1111' : '0000' }]) {
    const res = await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, body);
    assert.equal(res.status, 422, `${JSON.stringify(body)} should not deliver`);
  }

  const shelf = await shelfAt(world.shop.id);
  assert.equal(shelf.quantity, 10, 'a failed OTP must not touch stock');
  assert.equal(shelf.reserved, quantity);
});

test('delivery closes the order, drops the shelf, and records the COD cash', async () => {
  const { orderId, job, quantity } = await orderReadyForPickup();
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);

  const res = await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, {
    otpCode: job.otpCode,
    photoUrl: 'https://example.test/pod.jpg',
    note: 'Handed to the customer'
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(fresh.status, 'DELIVERED');
  assert.ok(fresh.otpVerifiedAt);
  assert.ok(fresh.completedAt);
  assert.equal(fresh.photoUrl, 'https://example.test/pod.jpg');

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { payment: true }
  });
  assert.equal(order.status, 'DELIVERED');
  assert.ok(order.deliveredAt);

  // The whole point of §1.4's "reserve, never decrement".
  const shelf = await shelfAt(world.shop.id);
  assert.equal(shelf.quantity, 10 - quantity, 'stock finally leaves the building');
  assert.equal(shelf.reserved, 0, 'and the hold comes off with it');
  assert.ok(shelf.lastConfirmedAt);

  assert.equal(order.payment.status, 'PAID');
  assert.equal(order.payment.collectedByRiderId, rider.id);
  assert.ok(order.payment.cashCollectedAt);
  assert.equal(order.payment.cashRemittedAt, null, 'the rider is still holding the money');
});

test('delivering twice is refused', async () => {
  const { job } = await orderReadyForPickup();
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode });

  const again = await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode });
  assert.equal(again.status, 409);

  const shelf = await shelfAt(world.shop.id);
  assert.equal(shelf.quantity, 8, 'stock is not decremented twice');
});

test('another rider cannot touch a job that is not theirs', async () => {
  const { job } = await orderReadyForPickup();
  const stranger = tokenFor(await createRider({ name: 'Stranger', lastLat: LAT, lastLng: LNG }));

  assert.equal((await as(stranger).post(`/api/rider/jobs/${job.id}/pickup`)).status, 404);
  assert.equal(
    (await as(stranger).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode })).status,
    404
  );
});

test('delivery resets the SKU stockout streak', async () => {
  const { job } = await orderReadyForPickup();
  await prisma.shopInventory.updateMany({
    where: { shopId: world.shop.id }, data: { consecutiveStockouts: 2 }
  });

  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode });

  assert.equal((await shelfAt(world.shop.id)).consecutiveStockouts, 0, '"consecutive" means consecutive');
});

// --- dead runs ---------------------------------------------------------------

test('a dead run pays the rider, cancels the order, and gives the stock back', async () => {
  const { orderId, job } = await orderReadyForPickup();

  const res = await as(riderToken).post(`/api/rider/jobs/${job.id}/dead-run`, {
    reason: 'Shop was shut when I arrived'
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(fresh.status, 'FAILED');
  assert.equal(fresh.isDeadRun, true);
  // `dead_run_fee` defaults to 0 because the client has not given a figure — the
  // field is wired, not invented (PLAN §7).
  assert.equal(fresh.deadRunFee.toFixed(2), '0.00');
  assert.equal(fresh.riderEarning.toFixed(2), '0.00');

  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { payment: true }
  });
  assert.equal(order.status, 'CANCELLED');
  assert.match(order.cancelReason, /shut/i);
  assert.equal(order.payment.status, 'FAILED', 'no COD cash was ever collected');

  const shelf = await shelfAt(world.shop.id);
  assert.equal(shelf.quantity, 10, 'the goods never left');
  assert.equal(shelf.reserved, 0, 'and the shop can sell them again');

  // The shop is not deducted — HANDOFF §3, the platform absorbs this in year one.
  assert.equal((await prisma.user.findUnique({ where: { id: world.shop.id } })).outstandingDue, 0);
});

test('a dead run frees the rider for the next job', async () => {
  const { job } = await orderReadyForPickup();
  await as(riderToken).post(`/api/rider/jobs/${job.id}/dead-run`, { reason: 'Nobody home' });

  assert.equal((await as(riderToken).post('/api/rider/shift', { isOnShift: false })).status, 200);
});

// --- PLAN §2's exit criterion ------------------------------------------------

test('EXIT CRITERION: placed → timed out → rerouted → accepted → delivered, stock correct throughout', async () => {
  const backup = await createShop({
    name: 'Backup Shop', industryId: world.industry.id, ...NEAR, safetyStockBuffer: 100
  });
  const backupToken = tokenFor(backup);

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await stockShop({ shopId: backup.id, productId: product.id, quantity: 6, sellingPrice: 110 });

  // 1. placed at shop A
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 2
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });
  const orderId = placed.body.order.id;
  assert.equal((await shelfAt(world.shop.id)).reserved, 2);

  // 2. shop A never answers
  await sweepExpiredAttempts({ now: new Date(Date.now() + 120_000) });
  assert.equal((await shelfAt(world.shop.id)).reserved, 0);
  assert.equal((await shelfAt(backup.id)).reserved, 2);

  // 3. shop B accepts and packs
  assert.equal((await as(backupToken).post(`/api/shop/offers/${orderId}/accept`)).status, 200);
  await as(backupToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  const ready = await as(backupToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });
  assert.equal(ready.body.delivery.assigned, true);

  // 4. the rider collects and delivers
  const job = await prisma.deliveryJob.findFirst({ where: { consumerOrderId: orderId } });
  assert.equal((await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`)).status, 200);
  assert.equal(
    (await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode })).status,
    200
  );

  // 5. the books
  const order = await prisma.consumerOrder.findUnique({
    where: { id: orderId }, include: { payment: true, attempts: { orderBy: { sequence: 'asc' } } }
  });
  assert.equal(order.status, 'DELIVERED');
  assert.equal(order.shopId, backup.id, 'the order belongs to the shop that actually served it');
  assert.deepEqual(order.attempts.map((a) => a.status), ['TIMED_OUT', 'ACCEPTED']);
  assert.equal(order.payment.status, 'PAID');

  const a = await shelfAt(world.shop.id);
  const b = await shelfAt(backup.id);
  assert.equal(a.quantity, 10, 'shop A never gave anything up');
  assert.equal(a.reserved, 0);
  assert.equal(b.quantity, 4, 'shop B sold two');
  assert.equal(b.reserved, 0);

  // The customer sees the whole story.
  const view = await as(token).get(`/api/customer/orders/${orderId}`);
  assert.equal(view.body.order.status, 'DELIVERED');
  assert.equal(view.body.order.shop.id, backup.id);
  assert.equal(view.body.order.attempts.length, 2);
});

// --- the code the customer reads out -----------------------------------------
//
// Added 2026-08-13, after finding that the rider screen has always said "ask the
// customer for the 4-digit code in their app" while no customer-facing endpoint
// returned one. The handshake was generated, stored and checked correctly; there
// was simply no way for the person holding the phone to know it, which made the
// last step of every delivery impossible to complete through the apps.

test('the customer can read the door code, but only while a rider is carrying the order', async () => {
  const { orderId, job } = await orderReadyForPickup();

  // Before pickup: assigned, so it is about to be asked for.
  const assigned = await as(token).get(`/api/customer/orders/${orderId}`);
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.order.deliveryCode, job.otpCode, 'the customer sees what the rider will ask for');
  assert.match(assigned.body.order.deliveryCode, /^\d{4}$/);

  // After delivery the code is spent, and stops being shown.
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode });

  const done = await as(token).get(`/api/customer/orders/${orderId}`);
  assert.equal(done.body.order.status, 'DELIVERED');
  assert.equal(done.body.order.deliveryCode, undefined, 'a spent code is not left on screen');
});

test('the door code is never in the orders list, and never in another customer\'s order', async () => {
  const { orderId, job } = await orderReadyForPickup();

  // The list is a different projection and must not gain it: a code belongs to
  // the one order you have open at the door.
  const list = await as(token).get('/api/customer/orders');
  assert.equal(list.status, 200);
  for (const o of list.body.orders ?? []) {
    assert.equal(o.deliveryCode, undefined, 'the list never carries a code');
  }

  // And it is scoped to the owner, like the rest of `getOrder`. `customerTokenFor`
  // signs an id, so the stranger has to be a real row — a token for a customer
  // that does not exist is rejected at the door as a 401 and would prove nothing
  // about scoping.
  const other = await prisma.customer.create({ data: { phone: '9876500777' } });
  const theirs = await as(customerTokenFor(other)).get(`/api/customer/orders/${orderId}`);
  assert.equal(theirs.status, 404, "somebody else's order is not readable at all");
  assert.ok(job.otpCode, 'the code exists — it is simply not theirs to read');
});
