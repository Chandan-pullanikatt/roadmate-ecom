// Phase 1.3 — hybrid catalog browse (by shop AND by product) plus cart CRUD.
//
// The rule this file exists to pin down: the customer never sees raw
// `quantity`. Everything offered is `(quantity - reserved) * safetyStockBuffer%`,
// because the shop is also selling across its counter and only corrects the
// number afterwards.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createShop, createRider, createProduct, stockShop, createCustomer
} from './helpers/factories.js';
import { sellableQty } from '../src/lib/inventory.js';

const LAT = 12.9716;
const LNG = 77.5946;

let world;
let customer;
let token;
let product;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  customer = await createCustomer();
  token = customerTokenFor(customer);
  await createRider({ lastLat: LAT, lastLng: LNG });
  product = await createProduct({
    name: 'Toor Dal 1kg',
    industryId: world.industry.id,
    ownerId: world.master.id
  });
});

after(async () => {
  await disconnect();
});

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path, body) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
const patch = (path, body) => request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body);
const del = (path) => request(app).delete(path).set('Authorization', `Bearer ${token}`);

// --- sellable quantity -------------------------------------------------------

test('sellableQty subtracts reservations then applies the safety buffer', () => {
  assert.equal(sellableQty({ quantity: 10, reserved: 0, isAvailable: true }, 90), 9);
  assert.equal(sellableQty({ quantity: 10, reserved: 4, isAvailable: true }, 90), 5); // floor(6*0.9)
  assert.equal(sellableQty({ quantity: 10, reserved: 10, isAvailable: true }, 90), 0);
  assert.equal(sellableQty({ quantity: 10, reserved: 20, isAvailable: true }, 90), 0, 'never negative');
  assert.equal(sellableQty({ quantity: 10, reserved: 0, isAvailable: false }, 90), 0);
  assert.equal(sellableQty({ quantity: 10, reserved: 0, isAvailable: true }, null), 10, 'null buffer sells all free stock');
});

// --- browse by shop ----------------------------------------------------------

test('shop catalog lists sellable stock, never the raw quantity', async () => {
  await prisma.user.update({ where: { id: world.shop.id }, data: { safetyStockBuffer: 90 } });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, reserved: 2, sellingPrice: 149.5 });

  const res = await get(`/api/customer/shops/${world.shop.id}/products`);
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);

  const item = res.body.items[0];
  assert.equal(item.productName, 'Toor Dal 1kg');
  assert.equal(item.availableQty, 7); // floor((10-2) * 0.9)
  assert.equal(item.price, '149.50', 'money is a fixed-2 string, not a Decimal object');
  assert.equal(item.quantity, undefined, 'raw stock must not leak');
});

// Sold out is a state, not an absence (HANDOFF §7.6). These two are the halves
// of that promise and they must stay apart: a row the shop switched off is not
// a row the shop has run out of.
test('shop catalog shows a fully reserved row as sold out, last, and unbuyable', async () => {
  const soldOut = await createProduct({ industryId: world.industry.id, ownerId: world.master.id });

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 5 });
  await stockShop({ shopId: world.shop.id, productId: soldOut.id, quantity: 5, reserved: 5 });

  const res = await get(`/api/customer/shops/${world.shop.id}/products`);
  assert.equal(res.body.items.length, 2, 'the sold-out row is present, not missing');
  assert.equal(res.body.inStockCount, 1);

  const [first, last] = res.body.items;
  assert.equal(first.productId, product.id);
  assert.equal(first.inStock, true);
  assert.equal(last.productId, soldOut.id, 'sold out sinks to the bottom');
  assert.equal(last.inStock, false);
  assert.equal(last.availableQty, 0);
});

test('shop catalog still hides a row the shop switched off or that was auto-hidden', async () => {
  const hidden = await createProduct({ industryId: world.industry.id, ownerId: world.master.id });

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 5 });
  await stockShop({ shopId: world.shop.id, productId: hidden.id, quantity: 5, isAvailable: false });

  const res = await get(`/api/customer/shops/${world.shop.id}/products`);
  assert.deepEqual(
    res.body.items.map((i) => i.productId),
    [product.id],
    'the shop is not vouching for that count at all, so "sold out" would be a claim nobody made'
  );
});

test('shop catalog 404s for an unknown shop and 400s for a bad id', async () => {
  assert.equal((await get('/api/customer/shops/999999/products')).status, 404);
  assert.equal((await get('/api/customer/shops/abc/products')).status, 400);
});

// --- browse by product -------------------------------------------------------

test('product search groups one product across every serviceable shop, cheapest first', async () => {
  const cheaper = await createShop({
    name: 'Cheaper', industryId: world.industry.id, latitude: LAT + 0.01, longitude: LNG
  });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 5, sellingPrice: 200 });
  await stockShop({ shopId: cheaper.id, productId: product.id, quantity: 5, sellingPrice: 150 });

  const res = await get(`/api/customer/products?lat=${LAT}&lng=${LNG}&industryId=${world.industry.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.products.length, 1, 'one card per product, not per shelf row');

  const offers = res.body.products[0].offers;
  assert.equal(offers.length, 2);
  assert.equal(offers[0].price, '150.00');
  assert.equal(offers[0].shop.id, cheaper.id);
});

test('product search excludes shops outside the service radius', async () => {
  const far = await createShop({
    industryId: world.industry.id, latitude: LAT + 0.2, longitude: LNG, serviceRadiusKm: 5
  });
  await stockShop({ shopId: far.id, productId: product.id, quantity: 5, sellingPrice: 10 });

  const res = await get(`/api/customer/products?lat=${LAT}&lng=${LNG}&industryId=${world.industry.id}`);
  assert.equal(res.body.products.length, 0);
});

test('product search filters by name', async () => {
  const other = await createProduct({ name: 'Basmati Rice', industryId: world.industry.id, ownerId: world.master.id });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 5 });
  await stockShop({ shopId: world.shop.id, productId: other.id, quantity: 5 });

  const res = await get(`/api/customer/products?lat=${LAT}&lng=${LNG}&q=rice`);
  assert.deepEqual(res.body.products.map((p) => p.name), ['Basmati Rice']);
});

test('product search needs coordinates', async () => {
  assert.equal((await get('/api/customer/products')).status, 400);
});

// --- cart --------------------------------------------------------------------

async function stockDefault(quantity = 10, sellingPrice = 100) {
  return stockShop({ shopId: world.shop.id, productId: product.id, quantity, sellingPrice });
}

test('cart starts empty', async () => {
  const res = await get('/api/customer/cart');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.carts, []);
});

test('adding an item creates the cart for that shop and prices it live', async () => {
  await stockDefault(10, 120);

  const res = await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 2
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.cart.shop.id, world.shop.id);
  assert.equal(res.body.cart.items.length, 1);
  assert.equal(res.body.cart.items[0].quantity, 2);
  assert.equal(res.body.cart.items[0].lineTotal, '240.00');
  assert.equal(res.body.cart.subtotal, '240.00');
});

test('adding the same line twice increments rather than duplicating', async () => {
  await stockDefault(10);
  await post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 2 });
  const res = await post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 3 });

  assert.equal(res.body.cart.items.length, 1);
  assert.equal(res.body.cart.items[0].quantity, 5);
});

test('a cart never spans shops — a second shop gets its own cart', async () => {
  const other = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  await stockDefault(10);
  await stockShop({ shopId: other.id, productId: product.id, quantity: 10 });

  await post('/api/customer/cart/items', { shopId: world.shop.id, productId: product.id, quantity: 1 });
  await post('/api/customer/cart/items', { shopId: other.id, productId: product.id, quantity: 1 });

  const res = await get('/api/customer/cart');
  assert.equal(res.body.carts.length, 2);
  assert.deepEqual(
    res.body.carts.map((c) => c.shop.id).sort((a, b) => a - b),
    [world.shop.id, other.id].sort((a, b) => a - b)
  );
});

test('a cart cannot exceed the sellable quantity', async () => {
  // buffer 100 → 4 sellable, not 4 raw
  await prisma.user.update({ where: { id: world.shop.id }, data: { safetyStockBuffer: 100 } });
  await stockDefault(4);

  const res = await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 5
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.availableQty, 4);
});

test('the safety buffer, not the raw stock, is the cart ceiling', async () => {
  await prisma.user.update({ where: { id: world.shop.id }, data: { safetyStockBuffer: 50 } });
  await stockDefault(10); // 10 in the shop, 5 sellable to the app

  assert.equal((await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 6
  })).status, 409);

  assert.equal((await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 5
  })).status, 201);
});

test('adding a product the shop does not stock is rejected', async () => {
  const res = await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 1
  });
  assert.equal(res.status, 404);
});

test('updating an item quantity reprices the cart, and 0 removes it', async () => {
  await stockDefault(10, 100);
  const added = await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 2
  });
  const itemId = added.body.cart.items[0].id;

  const up = await patch(`/api/customer/cart/items/${itemId}`, { quantity: 3 });
  assert.equal(up.status, 200);
  assert.equal(up.body.cart.subtotal, '300.00');

  const zero = await patch(`/api/customer/cart/items/${itemId}`, { quantity: 0 });
  assert.equal(zero.status, 200);
  assert.equal(zero.body.cart.items.length, 0);
});

test('one customer cannot touch another customer\'s cart item', async () => {
  await stockDefault(10);
  const added = await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 1
  });
  const itemId = added.body.cart.items[0].id;

  const intruder = customerTokenFor(await createCustomer());
  const res = await request(app)
    .patch(`/api/customer/cart/items/${itemId}`)
    .set('Authorization', `Bearer ${intruder}`)
    .send({ quantity: 5 });

  assert.equal(res.status, 404);
  const row = await prisma.cartItem.findUnique({ where: { id: itemId } });
  assert.equal(row.quantity, 1, 'the item must be untouched');
});

test('deleting an item, then the cart', async () => {
  await stockDefault(10);
  const added = await post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 1
  });
  const cartId = added.body.cart.id;
  const itemId = added.body.cart.items[0].id;

  assert.equal((await del(`/api/customer/cart/items/${itemId}`)).status, 200);
  assert.equal((await del(`/api/customer/cart/${cartId}`)).status, 200);
  assert.equal(await prisma.cart.count({ where: { id: cartId } }), 0);
});

test('cart endpoints require a customer token', async () => {
  assert.equal((await request(app).get('/api/customer/cart')).status, 401);
  assert.equal((await request(app).post('/api/customer/cart/items').send({})).status, 401);
});
