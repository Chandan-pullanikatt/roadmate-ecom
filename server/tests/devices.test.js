// Phase 2 — push registration. `POST /api/devices` (staff) and
// `POST /api/customer/devices` share one handler; `DeviceToken_owner_xor`
// is the schema's guarantee that a row never ends up owned by both.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import { createCustomer } from './helpers/factories.js';

let world;
let shopToken;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  shopToken = tokenFor(world.shop);
});

after(async () => {
  await disconnect();
});

test('a shop registers a device', async () => {
  const res = await request(app)
    .post('/api/devices')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ token: 'ExponentPushToken[abc]', platform: 'android' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.device.token, 'ExponentPushToken[abc]');

  const row = await prisma.deviceToken.findUnique({ where: { token: 'ExponentPushToken[abc]' } });
  assert.equal(row.userId, world.shop.id);
  assert.equal(row.customerId, null);
  assert.equal(row.isActive, true);
});

test('re-registering the same token upserts rather than erroring', async () => {
  await request(app)
    .post('/api/devices')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ token: 'ExponentPushToken[dup]', platform: 'android' });

  const res = await request(app)
    .post('/api/devices')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ token: 'ExponentPushToken[dup]', platform: 'ios' });

  assert.equal(res.status, 200);
  const rows = await prisma.deviceToken.findMany({ where: { token: 'ExponentPushToken[dup]' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'ios');
});

test('rejects an unknown platform', async () => {
  const res = await request(app)
    .post('/api/devices')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ token: 'ExponentPushToken[bad]', platform: 'windows-phone' });
  assert.equal(res.status, 400);
});

test('rejects a missing token', async () => {
  const res = await request(app)
    .post('/api/devices')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ platform: 'android' });
  assert.equal(res.status, 400);
});

test('requires auth', async () => {
  const res = await request(app)
    .post('/api/devices')
    .send({ token: 'ExponentPushToken[noauth]', platform: 'android' });
  assert.equal(res.status, 401);
});

test('a customer registers a device on the customer route, never as userId', async () => {
  const customer = await createCustomer();
  const token = customerTokenFor(customer);

  const res = await request(app)
    .post('/api/customer/devices')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: 'ExponentPushToken[cust]', platform: 'ios' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = await prisma.deviceToken.findUnique({ where: { token: 'ExponentPushToken[cust]' } });
  assert.equal(row.customerId, customer.id);
  assert.equal(row.userId, null);
});

test('a staff token cannot register on the customer route', async () => {
  const res = await request(app)
    .post('/api/customer/devices')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ token: 'ExponentPushToken[staffoncust]', platform: 'android' });
  assert.equal(res.status, 401);
});
