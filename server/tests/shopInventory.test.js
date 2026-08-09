// Phase 2 — the shelf, from the shop's side.
//
// Two things are being pinned here, and they are the two the screen would
// otherwise get wrong:
//
//   1. `reserved` is a floor under `quantity`. A shop correcting its count after
//      a walk-in sale must not be able to take the shelf below the units already
//      promised to in-flight consumer orders — and the refusal has to survive a
//      reservation landing *between* the read and the write.
//   2. An auto-hidden SKU comes back only through `/confirm`. Flipping
//      `isAvailable` is not a recount, and the endpoint says so.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import { createShop, createProduct, stockShop, createIndustry } from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';

let world;
let shopToken;
let product;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  shopToken = tokenFor(world.shop);
  product = await createProduct({
    name: 'TVS Chain Lube 2.0',
    industryId: world.industry.id,
    ownerId: world.master.id
  });
});

after(async () => {
  await disconnect();
});

const auth = (req) => req.set('Authorization', `Bearer ${shopToken}`);

// --- listing -----------------------------------------------------------------

test('lists the shelf with sellable separated from quantity', async () => {
  // Baseline's shop has a 90% buffer, and 2 of the 10 are reserved.
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, reserved: 2, sellingPrice: 294 });

  const res = await auth(request(app).get('/api/shop/inventory'));
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);

  const item = res.body.items[0];
  assert.equal(item.quantity, 10);
  assert.equal(item.reserved, 2);
  // (10 - 2) * 90% = 7.2 → 7. The screen shows both numbers because the gap
  // between them is not self-explanatory.
  assert.equal(item.sellable, 7);
  assert.equal(item.sellingPrice, '294.00');
  assert.equal(res.body.safetyStockBuffer, 90);
});

test('money comes back as a fixed-2 string, never a float', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, sellingPrice: '38.25' });
  const res = await auth(request(app).get('/api/shop/inventory'));
  assert.equal(res.body.items[0].sellingPrice, '38.25');
  assert.equal(typeof res.body.items[0].sellingPrice, 'string');
});

test('one shop never sees another shop’s shelf', async () => {
  const other = await createShop({ industryId: world.industry.id, latitude: 12.9, longitude: 77.5 });
  await stockShop({ shopId: other.id, productId: product.id, quantity: 5 });

  const res = await auth(request(app).get('/api/shop/inventory'));
  assert.equal(res.body.items.length, 0);
});

test('a non-shop staff token is refused', async () => {
  const res = await request(app)
    .get('/api/shop/inventory')
    .set('Authorization', `Bearer ${tokenFor(world.master)}`);
  assert.equal(res.status, 403);
});

// --- adding ------------------------------------------------------------------

test('adds a product to the shelf', async () => {
  const res = await auth(request(app).post('/api/shop/inventory')).send({
    productId: product.id,
    quantity: 12,
    sellingPrice: '294.00'
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.item.quantity, 12);
  assert.equal(res.body.item.sellingPrice, '294.00');
  assert.ok(res.body.item.lastConfirmedAt);
});

test('re-adding something already stocked is a correction, not a crash', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 3, sellingPrice: 100 });

  const res = await auth(request(app).post('/api/shop/inventory')).send({
    productId: product.id,
    quantity: 20,
    sellingPrice: '110.00'
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.item.quantity, 20);
  const rows = await prisma.shopInventory.count({ where: { shopId: world.shop.id } });
  assert.equal(rows, 1);
});

test('a shop cannot stock a product from another industry', async () => {
  const otherIndustry = await createIndustry({ name: 'Pharmacy', fulfilmentType: 'VERIFY_AND_DELIVER' });
  const foreign = await createProduct({ industryId: otherIndustry.id, ownerId: world.master.id });

  const res = await auth(request(app).post('/api/shop/inventory')).send({
    productId: foreign.id,
    sellingPrice: '10.00'
  });
  assert.equal(res.status, 403);
});

test('a price that is not a number is refused', async () => {
  const res = await auth(request(app).post('/api/shop/inventory')).send({
    productId: product.id,
    sellingPrice: 'free'
  });
  assert.equal(res.status, 400);
});

// --- correcting the count ----------------------------------------------------

test('corrects the count and stamps the confirmation', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });

  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ quantity: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.quantity, 4);
  assert.ok(res.body.item.lastConfirmedAt);
});

test('the count cannot go below what is reserved', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, reserved: 3 });

  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ quantity: 1 });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'BELOW_RESERVED');
  // And it tells the shop how many are spoken for, which is the only number
  // that makes the refusal actionable.
  assert.equal(res.body.reserved, 3);

  const after = await prisma.shopInventory.findUnique({ where: { id: row.id } });
  assert.equal(after.quantity, 10);
});

test('a reservation landing mid-edit still cannot be undercut', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, reserved: 0 });

  // The shop opens the screen seeing reserved = 0 and types 2. Before its write
  // lands, an order reserves 5 — exactly the race the conditional `updateMany`
  // exists for, simulated by moving `reserved` first and re-issuing the write
  // the shop had already composed.
  await prisma.shopInventory.update({ where: { id: row.id }, data: { reserved: 5 } });

  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ quantity: 2 });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'BELOW_RESERVED');
});

test('setting the count exactly to reserved is allowed', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, reserved: 3 });
  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ quantity: 3 });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.quantity, 3);
  assert.equal(res.body.item.sellable, 0);
});

test('a price change alone touches nothing else', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ sellingPrice: '129.50' });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.sellingPrice, '129.50');
  assert.equal(res.body.item.quantity, 10);
});

test('a shop cannot edit a row that is not on its shelf', async () => {
  const other = await createShop({ industryId: world.industry.id });
  const row = await stockShop({ shopId: other.id, productId: product.id, quantity: 5 });

  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ quantity: 1 });
  assert.equal(res.status, 404);
});

// --- hiding and re-confirming ------------------------------------------------

test('a shop may take a SKU off sale by hand and put it back', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });

  let res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ isAvailable: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.isAvailable, false);
  // Its own choice, so no recount is demanded of it.
  assert.equal(res.body.item.autoHidden, false);

  res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ isAvailable: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.isAvailable, true);
});

test('an auto-hidden SKU cannot be toggled back on — it must be confirmed', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  // What `reportStockout` leaves behind at the threshold (HANDOFF §3).
  await prisma.shopInventory.update({
    where: { id: row.id },
    data: { isAvailable: false, consecutiveStockouts: 3 }
  });

  const listed = await auth(request(app).get('/api/shop/inventory'));
  assert.equal(listed.body.items[0].autoHidden, true);

  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ isAvailable: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'NEEDS_CONFIRMATION');

  const after = await prisma.shopInventory.findUnique({ where: { id: row.id } });
  assert.equal(after.isAvailable, false);
});

test('confirming clears the stockout counter and puts the SKU back on sale', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  await prisma.shopInventory.update({
    where: { id: row.id },
    data: { isAvailable: false, consecutiveStockouts: 3 }
  });

  const res = await auth(request(app).post(`/api/shop/inventory/${row.id}/confirm`)).send({ quantity: 6 });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.isAvailable, true);
  assert.equal(res.body.item.consecutiveStockouts, 0);
  assert.equal(res.body.item.quantity, 6);
  assert.equal(res.body.item.autoHidden, false);
  assert.ok(res.body.item.lastConfirmedAt);
});

test('confirming without a count still clears the hide', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 7 });
  await prisma.shopInventory.update({
    where: { id: row.id },
    data: { isAvailable: false, consecutiveStockouts: 4 }
  });

  const res = await auth(request(app).post(`/api/shop/inventory/${row.id}/confirm`)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.item.quantity, 7);
  assert.equal(res.body.item.consecutiveStockouts, 0);
});

test('confirming below the reserved count is refused like any other correction', async () => {
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, reserved: 4 });

  const res = await auth(request(app).post(`/api/shop/inventory/${row.id}/confirm`)).send({ quantity: 2 });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'BELOW_RESERVED');
});

test('the hide threshold is read from config, not hardcoded', async () => {
  await setConfig(CONFIG_KEYS.STOCKOUT_HIDE_THRESHOLD, 2);
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  await prisma.shopInventory.update({
    where: { id: row.id },
    data: { isAvailable: false, consecutiveStockouts: 2 }
  });

  const res = await auth(request(app).patch(`/api/shop/inventory/${row.id}`)).send({ isAvailable: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'NEEDS_CONFIRMATION');
});

// --- the storefront toggle ---------------------------------------------------

test('the open toggle is the shop’s own switch out of the routing pool', async () => {
  let res = await auth(request(app).patch('/api/shop/storefront')).send({ isOpen: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.storefront.isOpen, false);

  const row = await prisma.user.findUnique({ where: { id: world.shop.id }, select: { isOpen: true } });
  assert.equal(row.isOpen, false);

  res = await auth(request(app).get('/api/shop/storefront'));
  assert.equal(res.body.storefront.isOpen, false);
});

test('operating hours must be HH:MM', async () => {
  let res = await auth(request(app).patch('/api/shop/storefront')).send({ openTime: '9am' });
  assert.equal(res.status, 400);

  res = await auth(request(app).patch('/api/shop/storefront')).send({ openTime: '09:00', closeTime: '20:00' });
  assert.equal(res.status, 200);
  assert.equal(res.body.storefront.openTime, '09:00');
});

test('a shop cannot raise its own safety-stock buffer', async () => {
  const res = await auth(request(app).patch('/api/shop/storefront')).send({ safetyStockBuffer: 100 });
  // Nothing settable was sent, so there is nothing to do — and the buffer is
  // untouched either way. It is the platform's protection, not the shop's dial.
  assert.equal(res.status, 400);

  const row = await prisma.user.findUnique({
    where: { id: world.shop.id },
    select: { safetyStockBuffer: true }
  });
  assert.equal(row.safetyStockBuffer, 90);
});
