// Two delivery modes (HANDOFF §3, 2026-08-08) — the foundation half.
//
// A shop either uses RoadMate's delivery partners or its own delivery boys, and
// the shop is the switch. The delivery flow is identical for both; ownership and
// money are what differ.
//
// The sharp edge, and the first thing this file pins: THE PLATFORM POOL MUST
// EXCLUDE SHOP-EMPLOYED RIDERS. A shop's boy left in the pool would be sent to
// collect a rival shop's order, and nothing else in the system would notice.
//
// ⚠️ **Two of HANDOFF §7.8's three money questions were answered on 2026-08-09,
// and both reversed what this file used to assert:**
//
//   · §7.8a COD cash — a shop's own boy hands the customer's cash to his shop,
//     so settlement DEDUCTS it from that shop's payout rather than collecting
//     it, and `GET /api/finance/cod-outstanding` stops counting him. The last
//     four tests in this file are that decision.
//
//   · Rider pay — the platform now pays EVERY rider ₹25 + ₹8/km, a shop's own
//     delivery boy included, and settles him weekly. This used to be zero, on
//     the reasoning that his employer pays him. It is a real cost for delivery
//     the platform does not perform; see `applyConfirmedConfig.js` for the
//     arithmetic the client was shown.
//
// §7.8c — whether a platform rider backs up a shop whose own boys are all busy —
// is **still unanswered**, and the test below pins that nobody does it today.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createShop, createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';
import { assignRiderIfPossible } from '../src/lib/delivery.js';
import { runRiderSettlement, runSettlement } from '../src/lib/settlement.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';

const LAT = 12.9716;
const LNG = 77.5946;

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

/** Turn the baseline shop into a self-delivering one. */
const useOwnRiders = (shopId = world.shop.id) =>
  prisma.user.update({ where: { id: shopId }, data: { usesOwnRiders: true } });

/**
 * Placed → accepted → packed → READY, which is what triggers assignment.
 *
 * `beforeReady` runs after the order is bound and before assignment happens, so
 * a test can arrange the rider situation it wants to assign *into* without
 * having to defeat the serviceability check at placement — those are two
 * different questions and this file asks both.
 */
async function orderReadyForPickup({
  shopId = world.shop.id,
  shopTok = shopToken,
  beforeReady
} = {}) {
  await stockShop({ shopId, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', { shopId, productId: product.id, quantity: 1 });
  const placed = await as(token).post('/api/customer/orders', {
    shopId, addressId: address.id, paymentMethod: 'COD'
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const orderId = placed.body.order.id;

  await as(shopTok).post(`/api/shop/offers/${orderId}/accept`);
  await as(shopTok).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  if (beforeReady) await beforeReady();
  const ready = await as(shopTok).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });
  assert.equal(ready.status, 200, JSON.stringify(ready.body));

  return { orderId, job: await prisma.deliveryJob.findFirst({ where: { consumerOrderId: orderId } }) };
}

// --- the pool split ----------------------------------------------------------

test("a shop's own delivery boy is never offered another shop's order", async () => {
  // THE test. A rival shop, on the platform pool, with an order to deliver —
  // and the only rider standing nearby belongs to somebody else.
  const rival = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  const rivalToken = tokenFor(rival);

  await useOwnRiders();
  await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  // A platform rider makes the rival's address serviceable, then clocks off
  // while the order is being packed — so the only rider left standing next to
  // the rival shop when it hits READY is somebody else's employee.
  const partner = await createRider({ lastLat: LAT, lastLng: LNG });

  const { job } = await orderReadyForPickup({
    shopId: rival.id,
    shopTok: rivalToken,
    beforeReady: () =>
      prisma.user.update({ where: { id: partner.id }, data: { isOnShift: false } })
  });

  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(fresh.riderId, null, "a shop's employee was handed a rival shop's order");
  assert.equal(fresh.status, 'UNASSIGNED');
});

test('the exclusion does not depend on the employer having switched the mode on', async () => {
  // A shop can hire staff before flipping the switch. He is still not RoadMate's
  // to dispatch in the meantime.
  const rival = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  const partner = await createRider({ lastLat: LAT, lastLng: LNG });
  assert.equal(
    (await prisma.user.findUnique({ where: { id: world.shop.id } })).usesOwnRiders,
    false
  );

  const { job } = await orderReadyForPickup({
    shopId: rival.id,
    shopTok: tokenFor(rival),
    beforeReady: () =>
      prisma.user.update({ where: { id: partner.id }, data: { isOnShift: false } })
  });
  assert.equal((await prisma.deliveryJob.findUnique({ where: { id: job.id } })).riderId, null);
});

test("a self-delivering shop's order goes to its own boy, not to a platform rider standing closer", async () => {
  await useOwnRiders();
  const platformRider = await createRider({ lastLat: LAT, lastLng: LNG });
  const ownBoy = await createRider({
    lastLat: LAT + 0.02, lastLng: LNG, employerShopId: world.shop.id
  });

  const { job } = await orderReadyForPickup();

  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(fresh.riderId, ownBoy.id);
  assert.notEqual(fresh.riderId, platformRider.id);
});

test('a shop on the platform pool is unaffected — its orders still go to RoadMate riders', async () => {
  const platformRider = await createRider({ lastLat: LAT, lastLng: LNG });
  await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });

  const { job } = await orderReadyForPickup();
  assert.equal((await prisma.deliveryJob.findUnique({ where: { id: job.id } })).riderId, platformRider.id);
});

test('a shop whose only boy is already out queues the next order rather than borrowing a platform rider', async () => {
  // HANDOFF §7.8c — whether a platform rider backs up a shop whose own boys are
  // all busy is the client's call, and is not guessed here. Until it is
  // answered the job waits, which is exactly what already happens when nobody
  // is on shift at all.
  await useOwnRiders();
  const platformRider = await createRider({ lastLat: LAT, lastLng: LNG }); // idle, and nearby
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });

  const first = await orderReadyForPickup();
  assert.equal((await prisma.deliveryJob.findUnique({ where: { id: first.job.id } })).riderId, boy.id);

  const second = await orderReadyForPickup();
  const fresh = await prisma.deliveryJob.findUnique({ where: { id: second.job.id } });
  assert.equal(fresh.status, 'UNASSIGNED');
  assert.equal(fresh.riderId, null, 'a platform rider silently backed up a shop-delivered order');
  assert.notEqual(fresh.riderId, platformRider.id);
});

test('hiring a rider mid-flight cannot slip them past the pool check', async () => {
  // The ranking and the claim are two statements. `assignRiderIfPossible`
  // re-asserts employment under the rider lock, so a hire landing in between is
  // seen.
  const platformRider = await createRider({ lastLat: LAT, lastLng: LNG });
  const { orderId } = await orderReadyForPickup();

  // The first assignment took the only rider; free the job again and employ him.
  await prisma.deliveryJob.updateMany({
    where: { consumerOrderId: orderId },
    data: { riderId: null, status: 'UNASSIGNED', assignedAt: null }
  });
  await prisma.user.update({
    where: { id: platformRider.id },
    data: { employerShopId: world.shop.id }
  });

  const result = await assignRiderIfPossible(orderId);
  assert.equal(result.assigned, false);
  assert.equal(result.reason, 'NO_RIDER');
});

// --- serviceability ----------------------------------------------------------

test("a shop's own boy makes it serviceable where the platform has no rider at all", async () => {
  // The launch-scale win: no RoadMate rider exists anywhere near this district.
  await useOwnRiders();
  await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });

  const res = await as(token).get(`/api/customer/serviceable?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.serviceable, true, JSON.stringify(res.body));
  assert.deepEqual(res.body.shops.map((s) => s.id), [world.shop.id]);
});

test('a self-delivering shop with everybody off shift is not serviceable, even with platform riders about', async () => {
  await useOwnRiders();
  await createRider({ lastLat: LAT, lastLng: LNG }); // platform coverage exists
  await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id, isOnShift: false });

  const res = await as(token).get(`/api/customer/serviceable?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.body.serviceable, false);
  assert.equal(res.body.reason, 'NO_RIDER');
});

test("the two modes are judged separately — one shop's staff does not carry another shop", async () => {
  const platformShop = await createShop({
    name: 'Platform', industryId: world.industry.id, latitude: LAT, longitude: LNG
  });
  await useOwnRiders();
  await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });

  // Only the self-delivering shop is deliverable: there is no platform rider.
  const res = await as(token).get(`/api/customer/serviceable?lat=${LAT}&lng=${LNG}`);
  assert.deepEqual(res.body.shops.map((s) => s.id), [world.shop.id]);
  assert.ok(!res.body.shops.some((s) => s.id === platformShop.id));
});

test('placement refuses a self-delivering shop whose staff are all off shift', async () => {
  await useOwnRiders();
  await createRider({ lastLat: LAT, lastLng: LNG }); // platform rider, irrelevant here
  await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id, isOnShift: false });

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 5, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 1
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });

  assert.equal(placed.status, 422);
  assert.equal(placed.body.reason, 'NO_RIDER');
});

// --- the shop's staff screen -------------------------------------------------

test('a shop hires, lists and releases its own delivery staff', async () => {
  const created = await as(shopToken).post('/api/shop/riders', {
    name: 'Ravi', phone: '9876500123', password: 'ravi1234', vehicleType: 'Bike'
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.rider.phone, '9876500123');

  const listed = await as(shopToken).get('/api/shop/riders');
  assert.equal(listed.body.riders.length, 1);
  assert.equal(listed.body.usesOwnRiders, false, 'hiring does not flip the mode by itself');

  // He is a real rider account, employed by this shop.
  const row = await prisma.user.findUnique({ where: { id: created.body.rider.id } });
  assert.equal(row.role, 'EXECUTIVE');
  assert.equal(row.executiveType, 'DELIVERY');
  assert.equal(row.employerShopId, world.shop.id);

  const released = await as(shopToken).patch(`/api/shop/riders/${created.body.rider.id}`, {
    isActive: false
  });
  assert.equal(released.status, 200);
  // Released, not unlinked: clearing the employer would push him into the
  // platform pool, which is the failure this whole feature exists to prevent.
  const after = await prisma.user.findUnique({ where: { id: created.body.rider.id } });
  assert.equal(after.isActive, false);
  assert.equal(after.employerShopId, world.shop.id);
});

test('a phone number is required and must be free, since it is the sign-in ID', async () => {
  const bad = await as(shopToken).post('/api/shop/riders', {
    name: 'Ravi', phone: '12345', password: 'ravi1234'
  });
  assert.equal(bad.status, 400);

  await as(shopToken).post('/api/shop/riders', {
    name: 'Ravi', phone: '+91 98765 00123', password: 'ravi1234'
  });
  const dup = await as(shopToken).post('/api/shop/riders', {
    name: 'Someone else', phone: '9876500123', password: 'other123'
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.reason, 'PHONE_TAKEN');
});

test("a shop cannot touch another shop's delivery staff", async () => {
  const rival = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  const theirs = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: rival.id });

  const res = await as(shopToken).patch(`/api/shop/riders/${theirs.id}`, { isActive: false });
  assert.equal(res.status, 404);

  const listed = await as(shopToken).get('/api/shop/riders');
  assert.deepEqual(listed.body.riders, []);
});

test('a rider out on a delivery cannot be taken off the roster', async () => {
  await useOwnRiders();
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  await orderReadyForPickup();

  const res = await as(shopToken).patch(`/api/shop/riders/${boy.id}`, { isActive: false });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'RIDER_ON_JOB');
  assert.equal((await prisma.user.findUnique({ where: { id: boy.id } })).isActive, true);
});

test('the delivery mode is a storefront switch, alongside "Shop is open"', async () => {
  const before = await as(shopToken).get('/api/shop/storefront');
  assert.equal(before.body.storefront.usesOwnRiders, false);

  const on = await as(shopToken).patch('/api/shop/storefront', { usesOwnRiders: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.storefront.usesOwnRiders, true);
  assert.equal((await prisma.user.findUnique({ where: { id: world.shop.id } })).usesOwnRiders, true);
});

// --- money: the one half that is answered ------------------------------------

test("RoadMate pays a shop's own delivery boy the same as anybody else, and settles him", async () => {
  await setConfig(CONFIG_KEYS.RIDER_BASE_FEE, '25');
  await setConfig(CONFIG_KEYS.RIDER_FREE_KM, '2');
  await setConfig(CONFIG_KEYS.RIDER_PER_KM_FEE, '8');

  await useOwnRiders();
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  const boyToken = tokenFor(boy);

  const { orderId, job } = await orderReadyForPickup();
  await as(boyToken).post(`/api/rider/jobs/${job.id}/pickup`);
  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  const delivered = await as(boyToken).post(`/api/rider/jobs/${job.id}/deliver`, {
    otpCode: fresh.otpCode
  });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));

  // ⚠️ **REVERSED on the client call of 2026-08-09.** This used to assert 0 and
  // no settlement row, on the reasoning that the shop employs and pays this
  // person. The client's answer is that RoadMate pays every rider — so a shop's
  // boy earns the base fare like anybody else, on top of whatever his employer
  // pays him. Shop and address are the same point here, so it is the base ₹25.
  const done = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(Number(done.riderEarning), 25, "the platform stopped paying a shop's employee");
  assert.equal(
    (await prisma.consumerOrder.findUnique({ where: { id: orderId } })).status,
    'DELIVERED'
  );

  // And he is settled weekly like any other rider — money earned that the run
  // never paid out would be worse than not earning it.
  const periodStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const periodEnd = new Date(Date.now() + 24 * 3600 * 1000);
  await runRiderSettlement({ periodStart, periodEnd });
  assert.equal(await prisma.riderSettlement.count({ where: { riderId: boy.id } }), 1);
});

test('a platform rider is still paid the confirmed ₹25 + ₹8/km — this changed nothing for them', async () => {
  await setConfig(CONFIG_KEYS.RIDER_BASE_FEE, '25');
  await setConfig(CONFIG_KEYS.RIDER_FREE_KM, '2');
  await setConfig(CONFIG_KEYS.RIDER_PER_KM_FEE, '8');

  const rider = await createRider({ lastLat: LAT, lastLng: LNG });
  const riderToken = tokenFor(rider);

  const { job } = await orderReadyForPickup();
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: fresh.otpCode });

  // Shop and address are the same point, so it is the base fare.
  const done = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(Number(done.riderEarning), 25);
});

test("the earnings screen is every rider's, a shop's own boy included", async () => {
  // ⚠️ **REVERSED 2026-08-09.** Was a 403 `EMPLOYED_BY_SHOP`, when the platform
  // paid somebody else's employee nothing. It pays every rider the same now, so
  // both kinds of rider get the same screen and the tab is no longer hidden.
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  assert.equal((await as(tokenFor(boy)).get('/api/rider/earnings')).status, 200);

  const partner = await createRider({ lastLat: LAT, lastLng: LNG });
  assert.equal((await as(tokenFor(partner)).get('/api/rider/earnings')).status, 200);
});

test('a rider learns who they work for from /api/auth/me', async () => {
  await prisma.user.update({
    where: { id: world.shop.id },
    data: { businessName: 'Kannan Motors' }
  });
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });

  const res = await as(tokenFor(boy)).get('/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.user.employerShopId, world.shop.id);
  assert.equal(res.body.user.employerShop.name, 'Kannan Motors');

  const partner = await createRider({ lastLat: LAT, lastLng: LNG });
  const them = await as(tokenFor(partner)).get('/api/auth/me');
  assert.equal(them.body.user.employerShopId, null);
  assert.equal(them.body.user.employerShop, null);
});

// --- COD cash, once §7.8a was answered (2026-08-09) --------------------------
//
// The shop's own boy takes the customer's cash to his shop, never to RoadMate.
// So settlement DEDUCTS it from the shop's weekly payout rather than collecting
// it — the platform never held that money, and any other answer has us chasing a
// shop's employee for cash.

/** Deliver an order end to end with `rider`, and return its id. */
async function deliverWith(riderToken) {
  const { orderId, job } = await orderReadyForPickup();
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  const done = await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, {
    otpCode: fresh.otpCode
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return orderId;
}

const settleThisWeek = () =>
  runSettlement({
    periodStart: new Date(Date.now() - 7 * 24 * 3600 * 1000),
    periodEnd: new Date(Date.now() + 24 * 3600 * 1000)
  });

test("COD taken by a shop's own boy is deducted, not collected", async () => {
  await useOwnRiders();
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  const orderId = await deliverWith(tokenFor(boy));

  await settleThisWeek();
  const settlement = await prisma.settlement.findFirst({ where: { shopId: world.shop.id } });
  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });

  // The cash is already the shop's, so it comes off the payout...
  assert.equal(Number(settlement.deductions), Number(order.grandTotal));
  // ...and is NOT recorded as money the platform collected and is holding.
  assert.equal(Number(settlement.codCollected), 0);
  // Paying `shopPayable` out on top would be paying the same sale twice.
  assert.equal(
    Number(settlement.netPayable),
    Number(order.shopPayable) - Number(order.grandTotal)
  );
});

test('COD taken by a platform rider is still collected and settled as before', async () => {
  const partner = await createRider({ lastLat: LAT, lastLng: LNG });
  const orderId = await deliverWith(tokenFor(partner));

  await settleThisWeek();
  const settlement = await prisma.settlement.findFirst({ where: { shopId: world.shop.id } });
  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });

  assert.equal(Number(settlement.codCollected), Number(order.grandTotal));
  assert.equal(Number(settlement.deductions), 0);
  assert.equal(Number(settlement.netPayable), Number(order.shopPayable));
});

test('a settlement may go negative — the shop owes the platform, and that is not clamped', async () => {
  // With `commission_percent` at 0 the shop's payable IS the grand total, so a
  // week of self-delivered COD nets to zero rather than to a payout. Clamping a
  // genuine debt at zero would write it off silently every week, which is the
  // failure this pins.
  await useOwnRiders();
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  await deliverWith(tokenFor(boy));

  await settleThisWeek();
  const settlement = await prisma.settlement.findFirst({ where: { shopId: world.shop.id } });
  assert.ok(Number(settlement.netPayable) <= 0, 'the shop was paid for cash it already holds');
});

test("the platform's COD reconciliation no longer counts a shop's own boy", async () => {
  // ⚠️ This view used to over-state incoming cash for every self-delivering
  // shop, and the rider screen carried a caveat saying so. The platform is never
  // owed this money, so it is not outstanding to the platform.
  await useOwnRiders();
  const boy = await createRider({ lastLat: LAT, lastLng: LNG, employerShopId: world.shop.id });
  await deliverWith(tokenFor(boy));

  const view = await as(tokenFor(world.master)).get('/api/finance/cod-outstanding');
  assert.equal(view.status, 200);
  assert.equal(view.body.riders.length, 0);
  assert.equal(Number(view.body.grandTotal), 0);
});
