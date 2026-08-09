// Phase 1.2 — serviceability + shop ranking.
//
// The ranking lives in `src/lib/shopRanking.js`, not in the controller, because
// the §2.5 reroute sweeper has to call it without going through HTTP. So this
// file tests the library directly *and* the endpoint that wraps it.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import { createShop, createRider, createCustomer } from './helpers/factories.js';
import { rankCandidateShops, hasRiderCoverage } from '../src/lib/shopRanking.js';

// Bangalore. 0.01° of latitude ≈ 1.11 km, which is how the fixtures below
// place shops at a known distance from the customer.
const LAT = 12.9716;
const LNG = 77.5946;

let world;
let customerToken;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  customerToken = customerTokenFor(await createCustomer());
});

after(async () => {
  await disconnect();
});

const ids = (rows) => rows.map((r) => r.id);

const get = (path) =>
  request(app).get(path).set('Authorization', `Bearer ${customerToken}`);

// --- rankCandidateShops: the filter ------------------------------------------

test('a shop within its own service radius is a candidate', async () => {
  const rows = await rankCandidateShops(LAT, LNG, world.industry.id);
  assert.deepEqual(ids(rows), [world.shop.id]);
  assert.ok(rows[0].distanceKm < 0.001, 'distance to itself is ~0');
});

test('a shop beyond its own service radius is excluded', async () => {
  // ~11.1 km north of the customer, radius 5 km.
  const far = await createShop({
    industryId: world.industry.id,
    latitude: LAT + 0.1,
    longitude: LNG,
    serviceRadiusKm: 5
  });

  const rows = await rankCandidateShops(LAT, LNG, world.industry.id);
  assert.ok(!ids(rows).includes(far.id));
});

test('radius is per shop, not global — a wide-radius shop 11 km out still qualifies', async () => {
  const wide = await createShop({
    industryId: world.industry.id,
    latitude: LAT + 0.1,
    longitude: LNG,
    serviceRadiusKm: 20
  });

  const rows = await rankCandidateShops(LAT, LNG, world.industry.id);
  assert.ok(ids(rows).includes(wide.id));
  const found = rows.find((r) => r.id === wide.id);
  assert.ok(found.distanceKm > 10 && found.distanceKm < 12, `got ${found.distanceKm} km`);
});

test('closed, inactive, non-shop and other-industry rows are all excluded', async () => {
  const other = await prisma.industry.create({
    data: { name: 'Pharmacy', slug: 'pharmacy', fulfilmentType: 'VERIFY_AND_DELIVER' }
  });

  const closed = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG, isOpen: false });
  const inactive = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG, isActive: false });
  const otherIndustry = await createShop({ industryId: other.id, latitude: LAT, longitude: LNG });
  const rider = await createRider({ lastLat: LAT, lastLng: LNG });

  const rows = await rankCandidateShops(LAT, LNG, world.industry.id);
  const got = ids(rows);

  assert.ok(!got.includes(closed.id), 'closed shop leaked');
  assert.ok(!got.includes(inactive.id), 'inactive shop leaked');
  assert.ok(!got.includes(otherIndustry.id), 'other industry leaked');
  assert.ok(!got.includes(rider.id), 'a non-SHOP user leaked');
});

test('a null industryId matches every industry', async () => {
  const other = await prisma.industry.create({
    data: { name: 'Fashion', slug: 'fashion', fulfilmentType: 'PICK_AND_DELIVER' }
  });
  const otherShop = await createShop({ industryId: other.id, latitude: LAT, longitude: LNG });

  const rows = await rankCandidateShops(LAT, LNG, null);
  assert.ok(ids(rows).includes(world.shop.id));
  assert.ok(ids(rows).includes(otherShop.id));
});

// --- rankCandidateShops: the order -------------------------------------------

test('ordering is routingPriority DESC, then distance ASC, then fulfilmentRate DESC', async () => {
  // Nearest of all, but demoted — must sort last.
  const demoted = await createShop({
    name: 'demoted', industryId: world.industry.id,
    latitude: LAT, longitude: LNG, routingPriority: -1
  });
  // Same priority as the baseline shop but further away.
  const far = await createShop({
    name: 'far', industryId: world.industry.id,
    latitude: LAT + 0.02, longitude: LNG, routingPriority: 0
  });
  // Promoted despite being the furthest — must sort first.
  const promoted = await createShop({
    name: 'promoted', industryId: world.industry.id,
    latitude: LAT + 0.03, longitude: LNG, routingPriority: 5
  });

  const rows = await rankCandidateShops(LAT, LNG, world.industry.id);
  assert.deepEqual(ids(rows), [promoted.id, world.shop.id, far.id, demoted.id]);
});

test('fulfilmentRate breaks a tie between two equidistant shops', async () => {
  const worse = await createShop({
    industryId: world.industry.id, latitude: LAT, longitude: LNG, fulfilmentRate: 60
  });
  const better = await createShop({
    industryId: world.industry.id, latitude: LAT, longitude: LNG, fulfilmentRate: 99
  });

  const rows = await rankCandidateShops(LAT, LNG, world.industry.id);
  const rank = (id) => ids(rows).indexOf(id);
  assert.ok(rank(better.id) < rank(worse.id), 'higher fulfilment rate should rank first');
});

// --- rankCandidateShops: options the sweeper needs ---------------------------

test('excludeShopIds drops shops already tried — this is what reroute uses', async () => {
  const second = await createShop({
    industryId: world.industry.id, latitude: LAT + 0.01, longitude: LNG
  });

  const rows = await rankCandidateShops(LAT, LNG, world.industry.id, {
    excludeShopIds: [world.shop.id]
  });
  assert.deepEqual(ids(rows), [second.id]);
});

test('limit caps the candidate list', async () => {
  await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  const rows = await rankCandidateShops(LAT, LNG, world.industry.id, { limit: 1 });
  assert.equal(rows.length, 1);
});

// --- rider coverage ----------------------------------------------------------

test('rider coverage needs a rider on shift within range', async () => {
  assert.equal(await hasRiderCoverage(LAT, LNG), false);

  const rider = await createRider({ lastLat: LAT + 0.01, lastLng: LNG, isOnShift: true });
  assert.equal(await hasRiderCoverage(LAT, LNG), true);

  await prisma.user.update({ where: { id: rider.id }, data: { isOnShift: false } });
  assert.equal(await hasRiderCoverage(LAT, LNG), false);
});

test('a rider on shift but far away does not create coverage', async () => {
  await createRider({ lastLat: LAT + 1, lastLng: LNG, isOnShift: true });
  assert.equal(await hasRiderCoverage(LAT, LNG), false);
});

// --- GET /api/customer/serviceable ------------------------------------------

test('serviceable requires a customer token', async () => {
  const res = await request(app).get(`/api/customer/serviceable?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.status, 401);
});

test('serviceable rejects missing or malformed coordinates', async () => {
  assert.equal((await get('/api/customer/serviceable')).status, 400);
  assert.equal((await get('/api/customer/serviceable?lat=abc&lng=77')).status, 400);
  assert.equal((await get('/api/customer/serviceable?lat=99&lng=77')).status, 400);
});

test('serviceable reports not serviceable when no rider is on shift', async () => {
  const res = await get(`/api/customer/serviceable?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.serviceable, false);
  assert.equal(res.body.reason, 'NO_RIDER');
  assert.deepEqual(res.body.shops, []);
});

test('serviceable reports not serviceable when a rider is on shift but no shop is in range', async () => {
  await createRider({ lastLat: LAT, lastLng: LNG });
  await prisma.user.update({ where: { id: world.shop.id }, data: { isOpen: false } });

  const res = await get(`/api/customer/serviceable?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.serviceable, false);
  assert.equal(res.body.reason, 'NO_SHOP');
});

test('serviceable returns the ranked shops with distance when both are present', async () => {
  await createRider({ lastLat: LAT, lastLng: LNG });
  const near = await createShop({
    name: 'Nearer', industryId: world.industry.id, latitude: LAT + 0.005, longitude: LNG
  });

  const res = await get(`/api/customer/serviceable?lat=${LAT}&lng=${LNG}&industryId=${world.industry.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.serviceable, true);
  assert.deepEqual(res.body.shops.map((s) => s.id), [world.shop.id, near.id]);
  assert.equal(typeof res.body.shops[0].distanceKm, 'number');
  // No password or bank details on a public customer-facing payload.
  assert.equal(res.body.shops[0].password, undefined);
  assert.equal(res.body.shops[0].email, undefined);
});
