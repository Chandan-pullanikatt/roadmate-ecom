// Rider pay — the hole this file was written to close.
//
// Riders are independent delivery partners, not platform employees (HANDOFF §3,
// revised 2026-08-07). Before this, `riderEarning` was written in exactly one
// place — `recordDeadRun()` — so a *successful* delivery recorded ₹0 and the
// rider app's earnings screen had nothing to render.
//
// Three things this file pins:
//   · a delivery pays base + per-km beyond a free radius, all three from config
//   · the earning is FROZEN at delivery, like the commission split — raising the
//     rate next month must not reprice a trip somebody already made
//   · the weekly run pays each job once, and is safe to re-run
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import { createRider, createProduct, stockShop, createCustomer, createAddress } from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';
import { riderEarningFor } from '../src/lib/riderPay.js';
import { runRiderSettlement } from '../src/lib/settlement.js';

const LAT = 12.9716;
const LNG = 77.5946;

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

  // A rate the client has not given yet, so every test states its own.
  await setConfig(CONFIG_KEYS.RIDER_BASE_FEE, 20);
  await setConfig(CONFIG_KEYS.RIDER_FREE_KM, 2);
  await setConfig(CONFIG_KEYS.RIDER_PER_KM_FEE, 6);
});

after(async () => {
  await disconnect();
});

const as = (t) => ({
  post: (path, body) => request(app).post(path).set('Authorization', `Bearer ${t}`).send(body),
  patch: (path, body) => request(app).patch(path).set('Authorization', `Bearer ${t}`).send(body),
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${t}`)
});

/**
 * Placed → accepted → packed → READY → picked. The drop address sits `dropKm`
 * north of the shop so the distance in the fee is a number the test chose.
 */
async function orderPickedUp({ dropKm = 0 } = {}) {
  // ~111 km per degree of latitude.
  await prisma.address.update({
    where: { id: address.id },
    data: { latitude: LAT + dropKm / 111 }
  });

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 1
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD'
  });
  const orderId = placed.body.order.id;

  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });

  const job = await prisma.deliveryJob.findFirst({ where: { consumerOrderId: orderId } });
  assert.equal(job.riderId, rider.id, 'the rider should have been assigned at READY');
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);

  return { orderId, job };
}

const deliverJob = (job) =>
  as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, { otpCode: job.otpCode });

const jobById = (id) => prisma.deliveryJob.findUnique({ where: { id } });

// --- the formula -------------------------------------------------------------

test('the fee is base plus per-km beyond the free radius', () => {
  const near = riderEarningFor({ distanceKm: 1.5, baseFee: 20, freeKm: 2, perKmFee: 6 });
  assert.equal(near.chargeableKm, 0);
  assert.equal(near.total.toFixed(2), '20.00'); // inside the free radius: base only

  const far = riderEarningFor({ distanceKm: 5, baseFee: 20, freeKm: 2, perKmFee: 6 });
  assert.equal(far.chargeableKm, 3);
  assert.equal(far.total.toFixed(2), '38.00'); // 20 + 3 × 6
});

test('an unrecorded distance still pays the base fare, and never NaN', () => {
  // `ensureDeliveryJob` leaves `distanceKm` null when a shop or address has no
  // coordinates. The rider made the trip either way.
  const paid = riderEarningFor({ distanceKm: null, baseFee: 20, freeKm: 2, perKmFee: 6 });
  assert.equal(paid.total.toFixed(2), '20.00');
});

test('unset rates pay nothing — a visible zero, not an invented rate', () => {
  const unset = riderEarningFor({ distanceKm: 8, baseFee: 0, freeKm: 0, perKmFee: 0 });
  assert.equal(unset.total.toFixed(2), '0.00');
});

// --- written at delivery -----------------------------------------------------

test('a successful delivery records what the rider earned', async () => {
  const { job } = await orderPickedUp({ dropKm: 4 });
  assert.equal(job.riderEarning, null, 'nothing is owed until the trip is made');

  const res = await deliverJob(job);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const done = await jobById(job.id);
  // 20 base + (distanceKm − 2 free) × 6. The shop and drop are 4 km apart, and
  // `distanceKm` is the straight line the job recorded.
  const expected = 20 + Math.max(0, done.distanceKm - 2) * 6;
  assert.equal(Number(done.riderEarning), Math.round(expected * 100) / 100);
  assert.ok(Number(done.riderEarning) > 20, 'a 4 km drop must pay more than the base fare');

  // And the rider sees it.
  assert.equal(res.body.job.riderEarning, Number(done.riderEarning).toFixed(2));
});

test('the earning is frozen at delivery — a later rate rise does not reprice the trip', async () => {
  const { job } = await orderPickedUp({ dropKm: 4 });
  await deliverJob(job);
  const atDelivery = (await jobById(job.id)).riderEarning;

  await setConfig(CONFIG_KEYS.RIDER_BASE_FEE, 500);

  assert.equal(
    String((await jobById(job.id)).riderEarning),
    String(atDelivery),
    'a delivered job must never be recomputed'
  );
});

test('a per-industry rate beats the global one', async () => {
  await setConfig(CONFIG_KEYS.RIDER_BASE_FEE, 99, world.industry.id);

  const { job } = await orderPickedUp({ dropKm: 0 });
  await deliverJob(job);

  assert.equal(Number((await jobById(job.id)).riderEarning), 99);
});

test('a dead run still pays the dead-run fee, and is not a delivery fee', async () => {
  await setConfig(CONFIG_KEYS.DEAD_RUN_FEE, 30);
  const { job } = await orderPickedUp({ dropKm: 4 });

  const res = await as(riderToken).post(`/api/rider/jobs/${job.id}/dead-run`, { reason: 'Nobody home' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const done = await jobById(job.id);
  assert.equal(Number(done.riderEarning), 30);
  assert.equal(Number(done.deadRunFee), 30);
  assert.equal(done.isDeadRun, true);
});

// --- the settlement path -----------------------------------------------------

const WEEK = {
  periodStart: new Date('2000-01-03T00:00:00Z'),
  periodEnd: new Date('2100-01-04T00:00:00Z') // wide enough to catch "now"
};

test('the weekly run pays the rider what the jobs recorded', async () => {
  const first = await orderPickedUp({ dropKm: 4 });
  await deliverJob(first.job);
  const second = await orderPickedUp({ dropKm: 0 });
  await deliverJob(second.job);

  const result = await runRiderSettlement(WEEK);
  assert.equal(result.riderCount, 1);

  const settlement = await prisma.riderSettlement.findFirst({
    where: { riderId: rider.id },
    include: { lines: true }
  });
  assert.equal(settlement.deliveries, 2);
  assert.equal(settlement.deadRuns, 0);
  assert.equal(settlement.lines.length, 2);

  const jobs = await prisma.deliveryJob.findMany({ where: { riderId: rider.id } });
  const owed = jobs.reduce((sum, j) => sum + Number(j.riderEarning ?? 0), 0);
  assert.equal(Number(settlement.netPayable), owed);
  assert.equal(Number(settlement.grossEarning), owed);
});

test('a dead run is settled too, and counted separately from a delivery', async () => {
  await setConfig(CONFIG_KEYS.DEAD_RUN_FEE, 30);
  const { job } = await orderPickedUp({ dropKm: 4 });
  await as(riderToken).post(`/api/rider/jobs/${job.id}/dead-run`, { reason: 'Nobody home' });

  await runRiderSettlement(WEEK);

  const settlement = await prisma.riderSettlement.findFirst({ where: { riderId: rider.id } });
  assert.equal(settlement.deliveries, 0);
  assert.equal(settlement.deadRuns, 1);
  assert.equal(Number(settlement.grossEarning), 0);
  assert.equal(Number(settlement.deadRunFees), 30);
  assert.equal(Number(settlement.netPayable), 30);
});

test('re-running the week pays nothing twice', async () => {
  const { job } = await orderPickedUp({ dropKm: 4 });
  await deliverJob(job);

  await runRiderSettlement(WEEK);
  const again = await runRiderSettlement(WEEK);

  assert.equal(again.riderCount, 0, 'nothing left to settle');
  assert.equal(await prisma.riderSettlement.count(), 1);
  assert.equal(await prisma.riderSettlementLine.count(), 1);
});

test('a job outside the window is left for its own week', async () => {
  const { job } = await orderPickedUp({ dropKm: 4 });
  await deliverJob(job);

  const result = await runRiderSettlement({
    periodStart: new Date('2020-01-06T00:00:00Z'),
    periodEnd: new Date('2020-01-13T00:00:00Z')
  });

  assert.equal(result.riderCount, 0);
  assert.equal(await prisma.riderSettlement.count(), 0);
});

// --- the earnings screen -----------------------------------------------------

test('GET /api/rider/earnings is what Phase 3 renders', async () => {
  const { job } = await orderPickedUp({ dropKm: 4 });
  await deliverJob(job);
  const earned = Number((await jobById(job.id)).riderEarning);

  const before = await as(riderToken).get('/api/rider/earnings');
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.today.deliveries, 1);
  assert.equal(before.body.today.earned, earned.toFixed(2));
  assert.equal(before.body.pending.jobCount, 1);
  assert.equal(before.body.pending.total, earned.toFixed(2));
  assert.equal(before.body.settlements.length, 0);
  // A rider is entitled to know how their own pay is worked out — unlike
  // `commission_percent`, which is on no screen anywhere.
  assert.equal(before.body.rates.baseFee, '20.00');
  assert.equal(before.body.rates.perKmFee, '6.00');

  await runRiderSettlement(WEEK);

  const after = await as(riderToken).get('/api/rider/earnings');
  assert.equal(after.body.pending.jobCount, 0, 'settled work is no longer pending');
  assert.equal(after.body.settlements.length, 1);
  assert.equal(after.body.settlements[0].netPayable, earned.toFixed(2));
  assert.equal(after.body.settlements[0].status, 'OPEN');
  // Today's earnings are a fact about the day, not about whether it has been paid.
  assert.equal(after.body.today.earned, earned.toFixed(2));
});

test('one rider never sees another rider’s money', async () => {
  const { job } = await orderPickedUp({ dropKm: 4 });
  await deliverJob(job);

  const other = await createRider({ lastLat: LAT, lastLng: LNG, isOnShift: false });
  const res = await as(tokenFor(other)).get('/api/rider/earnings');

  assert.equal(res.status, 200);
  assert.equal(res.body.pending.jobCount, 0);
  assert.equal(res.body.today.earned, '0.00');
});

test('the earnings endpoint is riders only', async () => {
  const res = await as(shopToken).get('/api/rider/earnings');
  assert.equal(res.status, 403);
});
