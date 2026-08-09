// Where a shop is (PHASE A.1).
//
// Until this landed, a shop's location could not be set anywhere in the product:
// `POST /api/partners/create` accepted no coordinates and the shop's own
// storefront endpoint edited only `isOpen`/hours/`prepTimeMin`. A real shop
// onboarded today got NULL coordinates, and that is not "unranked" — it is
// invisible. `rankCandidateShops` prefilters on the lat/lng index and refines by
// haversine, so a NULL-coordinate shop matches nothing, forever, with nothing
// anywhere reporting it missing.
//
// So the first test in this file is that last claim, end to end: a shop with no
// coordinates cannot be found by a customer standing outside it. Everything else
// here is the three ways a pin now gets set — at onboarding, by the shop, and by
// an operator — and the scoping on the last one.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import { createShop, createRider, createCustomer } from './helpers/factories.js';

const LAT = 12.9716;
const LNG = 77.5946;

let world;
let masterToken;
let customerToken;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  masterToken = tokenFor(world.master);
  customerToken = customerTokenFor(await createCustomer());
  // Serviceability is *shop in range* AND *rider on shift*; this file is about
  // the first, so keep a platform rider standing on the point throughout.
  await createRider({ lastLat: LAT, lastLng: LNG });
});

/** "Can a customer standing at this point be served by anybody?" */
const serviceableAt = (lat, lng) =>
  request(app)
    .get('/api/customer/serviceable')
    .set('Authorization', `Bearer ${customerToken}`)
    .query({ lat, lng, industryId: world.industry.id });

after(async () => {
  await disconnect();
});

// ── The failure this whole phase exists to remove ──────────────────────────

test('a shop with no coordinates is invisible to a customer standing outside it', async () => {
  // The baseline shop is placed; take it off the map to make the point.
  await prisma.user.update({
    where: { id: world.shop.id },
    data: { latitude: null, longitude: null }
  });

  const res = await serviceableAt(LAT, LNG);

  assert.equal(res.status, 200);
  assert.equal(res.body.serviceable, false);
  // NO_SHOP, not NO_RIDER — there is a rider on shift right here. The shop is
  // open, active and stocked; it simply has no location.
  assert.equal(res.body.reason, 'NO_SHOP');
});

// ── 1. At onboarding ───────────────────────────────────────────────────────

const shopPayload = (extra = {}) => ({
  role: 'SHOP',
  name: 'Corner Store',
  email: `corner-${Math.random().toString(36).slice(2)}@test.roadmate`,
  password: 'test1234',
  industryId: world.industry.id,
  ...extra
});

test('onboarding a SHOP without coordinates is refused', async () => {
  const res = await request(app)
    .post('/api/partners/create')
    .set('Authorization', `Bearer ${masterToken}`)
    .send(shopPayload());

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'LOCATION_REQUIRED');
  // And nothing was created — a half-onboarded shop is worse than none.
  const count = await prisma.user.count({ where: { name: 'Corner Store' } });
  assert.equal(count, 0);
});

test('onboarding a SHOP with coordinates stores them and it becomes findable', async () => {
  const res = await request(app)
    .post('/api/partners/create')
    .set('Authorization', `Bearer ${masterToken}`)
    .send(shopPayload({ latitude: LAT, longitude: LNG, serviceRadiusKm: 7 }));

  assert.equal(res.status, 201);
  assert.equal(res.body.partner.latitude, LAT);
  assert.equal(res.body.partner.longitude, LNG);
  assert.equal(res.body.partner.serviceRadiusKm, 7);

  const found = await serviceableAt(LAT, LNG);
  assert.equal(found.body.serviceable, true);
});

test('a non-SHOP role still onboards without coordinates', async () => {
  // Nothing geographic is ever asked of a distributor; requiring a pin from one
  // would be a new obstacle in a flow that works.
  const res = await request(app)
    .post('/api/partners/create')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      role: 'DISTRIBUTOR',
      name: 'Acme Distribution',
      email: `acme-${Math.random().toString(36).slice(2)}@test.roadmate`,
      password: 'test1234',
      industryId: world.industry.id
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.partner.latitude, null);
});

test('a malformed coordinate is refused rather than silently dropped', async () => {
  for (const bad of [
    { latitude: 'somewhere', longitude: LNG },
    { latitude: LAT }, // longitude missing — half a location is not a location
    { latitude: 91, longitude: LNG },
    { latitude: LAT, longitude: 181 }
  ]) {
    const res = await request(app)
      .post('/api/partners/create')
      .set('Authorization', `Bearer ${masterToken}`)
      .send(shopPayload(bad));
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.reason, 'LOCATION_REQUIRED');
  }
});

test('a service radius outside the ceiling is refused', async () => {
  for (const km of [0, -3, 500]) {
    const res = await request(app)
      .post('/api/partners/create')
      .set('Authorization', `Bearer ${masterToken}`)
      .send(shopPayload({ latitude: LAT, longitude: LNG, serviceRadiusKm: km }));
    assert.equal(res.status, 400, `radius ${km}`);
    assert.equal(res.body.reason, 'BAD_SERVICE_RADIUS');
  }
});

test('an omitted service radius falls back rather than becoming 0', async () => {
  const res = await request(app)
    .post('/api/partners/create')
    .set('Authorization', `Bearer ${masterToken}`)
    .send(shopPayload({ latitude: LAT, longitude: LNG }));

  assert.equal(res.status, 201);
  // The schema default (5), not 0. A 0 would be a shop that delivers nowhere.
  assert.equal(res.body.partner.serviceRadiusKm, 5);
});

// ── 2. The shop's own pin ──────────────────────────────────────────────────

test('the storefront reports whether the shop is on the map at all', async () => {
  const unplaced = await createShop({ industryId: world.industry.id });
  const res = await request(app)
    .get('/api/shop/storefront')
    .set('Authorization', `Bearer ${tokenFor(unplaced)}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.storefront.locationSet, false);
  assert.equal(res.body.storefront.latitude, null);
});

test('a shop can correct its own pin, and is then findable', async () => {
  const unplaced = await createShop({ industryId: world.industry.id, serviceRadiusKm: 5 });
  // Move the baseline shop far away so this one is the only candidate.
  await prisma.user.update({ where: { id: world.shop.id }, data: { isOpen: false } });

  const res = await request(app)
    .patch('/api/shop/storefront')
    .set('Authorization', `Bearer ${tokenFor(unplaced)}`)
    .send({ latitude: LAT, longitude: LNG });

  assert.equal(res.status, 200);
  assert.equal(res.body.storefront.locationSet, true);
  assert.equal(res.body.storefront.latitude, LAT);

  const found = await serviceableAt(LAT, LNG);
  assert.equal(found.body.serviceable, true);
});

test('a shop cannot move one coordinate without the other', async () => {
  // Half a move lands the shop at its old latitude and a new longitude, which is
  // a real place, somewhere else, that a rider would be sent to.
  const res = await request(app)
    .patch('/api/shop/storefront')
    .set('Authorization', `Bearer ${tokenFor(world.shop)}`)
    .send({ longitude: 80.2707 });

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'BAD_LOCATION');

  const after = await prisma.user.findUnique({ where: { id: world.shop.id } });
  assert.equal(after.longitude, LNG);
});

test('a shop cannot widen its own service radius', async () => {
  // Same rule as `safetyStockBuffer`: how far the platform will send a rider is
  // a commercial term, not the shop's dial. Ignored, not refused — it arrives
  // alongside fields that are the shop's, and rejecting the whole PATCH would
  // block a legitimate one.
  const res = await request(app)
    .patch('/api/shop/storefront')
    .set('Authorization', `Bearer ${tokenFor(world.shop)}`)
    .send({ isOpen: true, serviceRadiusKm: 40 });

  assert.equal(res.status, 200);
  assert.equal(res.body.storefront.serviceRadiusKm, 5);
});

// ── 3. The operator's side ─────────────────────────────────────────────────

test('an operator can place a shop that was onboarded without coordinates', async () => {
  const unplaced = await createShop({ industryId: world.industry.id });

  const res = await request(app)
    .patch(`/api/partners/${unplaced.id}/location`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ latitude: LAT, longitude: LNG, serviceRadiusKm: 8 });

  assert.equal(res.status, 200);
  assert.equal(res.body.partner.latitude, LAT);
  assert.equal(res.body.partner.serviceRadiusKm, 8);
});

test('blanking the service radius clears it rather than writing 0', async () => {
  // The Master settings screen's rule, applied to the same kind of field: unset
  // means "fall back to `service_radius_km`", 0 means "delivers nowhere".
  const res = await request(app)
    .patch(`/api/partners/${world.shop.id}/location`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ serviceRadiusKm: '' });

  assert.equal(res.status, 200);
  assert.equal(res.body.partner.serviceRadiusKm, null);
});

test('an operator cannot move a shop outside their own scope', async () => {
  const otherShop = await createShop({
    industryId: world.industry.id, latitude: LAT, longitude: LNG
  });
  await prisma.user.update({
    where: { id: otherShop.id },
    data: { regionName: 'Region A', industryId: world.industry.id }
  });

  const outsider = await prisma.user.create({
    data: {
      email: `regional-${Math.random().toString(36).slice(2)}@test.roadmate`,
      password: world.shop.password,
      name: 'Regional B',
      role: 'REGIONAL',
      isActive: true,
      regionName: 'Region B',
      industryId: world.industry.id
    }
  });

  const res = await request(app)
    .patch(`/api/partners/${otherShop.id}/location`)
    .set('Authorization', `Bearer ${tokenFor(outsider)}`)
    .send({ latitude: 19.076, longitude: 72.8777 });

  // 404, not 403: "not yours" and "not there" are deliberately the same answer,
  // because distinguishing them confirms a partner exists.
  assert.equal(res.status, 404);

  const unmoved = await prisma.user.findUnique({ where: { id: otherShop.id } });
  assert.equal(unmoved.latitude, LAT);
});

test('a location update with nothing in it is refused', async () => {
  const res = await request(app)
    .patch(`/api/partners/${world.shop.id}/location`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({});

  assert.equal(res.status, 400);
});
