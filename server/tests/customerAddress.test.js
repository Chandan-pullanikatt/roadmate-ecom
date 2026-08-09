// Address book — the input side of §1.4, which takes an `addressId`.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import { createCustomer, createAddress } from './helpers/factories.js';

const LAT = 12.9716;
const LNG = 77.5946;

let customer;
let token;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  await seedBaseline();
  customer = await createCustomer();
  token = customerTokenFor(customer);
});

after(async () => {
  await disconnect();
});

const post = (body) => request(app).post('/api/customer/addresses').set('Authorization', `Bearer ${token}`).send(body);
const list = () => request(app).get('/api/customer/addresses').set('Authorization', `Bearer ${token}`);
const del = (id) => request(app).delete(`/api/customer/addresses/${id}`).set('Authorization', `Bearer ${token}`);

const VALID = { label: 'Home', line1: '12 MG Road', city: 'Bengaluru', latitude: LAT, longitude: LNG };

test('addresses require a customer token', async () => {
  assert.equal((await request(app).get('/api/customer/addresses')).status, 401);
});

test('creating an address stores the map pin', async () => {
  const res = await post(VALID);
  assert.equal(res.status, 201);
  assert.equal(res.body.address.line1, '12 MG Road');
  assert.equal(res.body.address.latitude, LAT);
  assert.equal(res.body.address.isDefault, true, 'the first address is the default');
});

test('an address without coordinates is rejected — it cannot be routed', async () => {
  assert.equal((await post({ line1: '12 MG Road' })).status, 400);
  assert.equal((await post({ ...VALID, latitude: 999 })).status, 400);
  assert.equal((await post({ ...VALID, line1: '  ' })).status, 400);
  assert.equal(await prisma.address.count(), 0);
});

test('only one address is ever the default', async () => {
  await post(VALID);
  await post({ ...VALID, label: 'Work', line1: '9 Residency Rd', isDefault: true });

  const res = await list();
  const defaults = res.body.addresses.filter((a) => a.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].label, 'Work');
  assert.equal(res.body.addresses[0].label, 'Work', 'the default sorts first');
});

test('a customer sees and deletes only their own addresses', async () => {
  const mine = await post(VALID);
  const stranger = await createCustomer();
  const theirs = await createAddress({ customerId: stranger.id, latitude: LAT, longitude: LNG });

  assert.deepEqual((await list()).body.addresses.map((a) => a.id), [mine.body.address.id]);
  assert.equal((await del(theirs.id)).status, 404);
  assert.equal(await prisma.address.count({ where: { id: theirs.id } }), 1);
});

test('an address attached to an order cannot be deleted', async () => {
  const created = await post(VALID);
  const addressId = created.body.address.id;
  const industry = await prisma.industry.findFirst();

  await prisma.consumerOrder.create({
    data: {
      orderNumber: 'RM-TEST-1',
      customerId: customer.id,
      addressId,
      industryId: industry.id,
      subtotal: 100,
      grandTotal: 100
    }
  });

  assert.equal((await del(addressId)).status, 409);
  assert.equal(await prisma.address.count({ where: { id: addressId } }), 1);
});

test('deleting an unused address works', async () => {
  const created = await post(VALID);
  assert.equal((await del(created.body.address.id)).status, 200);
  assert.equal(await prisma.address.count(), 0);
});
