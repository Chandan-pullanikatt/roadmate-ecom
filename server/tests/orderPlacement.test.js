// Phase 1.4 — order placement.
//
// The whole point of this phase is the first test in this file: two customers
// racing for the last unit. Stock reservation is a conditional UPDATE inside a
// transaction, never read-then-write, and exactly one of the two must win.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createShop, createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';

const LAT = 12.9716;
const LNG = 77.5946;

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

/** Give `who` a cart at the baseline shop holding `quantity` of `product`. */
async function cartFor(t, quantity = 1, shopId = world.shop.id) {
  const res = await as(t).post('/api/customer/cart/items', { shopId, productId: product.id, quantity });
  assert.ok(res.status < 300, `add to cart failed: ${JSON.stringify(res.body)}`);
  return res.body.cart.id;
}

const place = (t, body) => as(t).post('/api/customer/orders', body);

// --- the concurrency test ----------------------------------------------------

test('two customers racing for the last unit: exactly one order is created', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 1, sellingPrice: 100 });

  const other = await createCustomer();
  const otherToken = customerTokenFor(other);
  const otherAddress = await createAddress({ customerId: other.id, latitude: LAT, longitude: LNG });

  await cartFor(token, 1);
  await cartFor(otherToken, 1);

  const [a, b] = await Promise.all([
    place(token, { shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD' }),
    place(otherToken, { shopId: world.shop.id, addressId: otherAddress.id, paymentMethod: 'COD' })
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409], `got ${JSON.stringify([a.body, b.body])}`);

  assert.equal(await prisma.consumerOrder.count(), 1);

  const shelf = await prisma.shopInventory.findFirst({ where: { shopId: world.shop.id } });
  assert.equal(shelf.quantity, 1, 'quantity only drops at delivery, not at placement');
  assert.equal(shelf.reserved, 1, 'exactly one unit is held, never two');
});

test('a failed placement leaves no reservation behind', async () => {
  // Two lines: the second is short, so the whole transaction must roll back and
  // the first line's reservation must not survive.
  const scarce = await createProduct({ industryId: world.industry.id, ownerId: world.master.id });
  const plenty = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  const scarceRow = await stockShop({ shopId: world.shop.id, productId: scarce.id, quantity: 5 });

  await cartFor(token, 2);
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: scarce.id, quantity: 5
  });
  // Someone else takes the scarce stock between add-to-cart and checkout.
  await prisma.shopInventory.update({ where: { id: scarceRow.id }, data: { reserved: 5 } });

  const res = await place(token, { shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD' });
  assert.equal(res.status, 409);

  assert.equal((await prisma.shopInventory.findUnique({ where: { id: plenty.id } })).reserved, 0);
  assert.equal(await prisma.consumerOrder.count(), 0);
  assert.equal(await prisma.consumerOrderItem.count(), 0);
});

test('the safety buffer is enforced at placement, not only in the cart', async () => {
  await prisma.user.update({ where: { id: world.shop.id }, data: { safetyStockBuffer: 50 } });
  const row = await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });

  await cartFor(token, 5); // the cart ceiling: floor(10 * 50%)

  // Stock drops behind the customer's back: 6 free, so 3 sellable — not enough.
  await prisma.shopInventory.update({ where: { id: row.id }, data: { reserved: 4 } });

  const res = await place(token, { shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD' });
  assert.equal(res.status, 409);
});

// --- the happy path ----------------------------------------------------------

test('COD placement creates the order, its items, a pending COD payment, and clears the cart', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 120 });
  const cartId = await cartFor(token, 2);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', instructions: 'Ring the bell'
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const order = res.body.order;
  assert.match(order.orderNumber, /^RM-/);
  // §1.5: a COD order is offered to the cart's shop the moment it is placed, so
  // it leaves placement already ROUTING. PLACED now means "not yet offered",
  // which is only prepaid awaiting its webhook.
  assert.equal(order.status, 'ROUTING');
  assert.equal(order.subtotal, '240.00');
  assert.equal(order.grandTotal, '240.00');
  assert.equal(order.paymentMethod, 'COD');
  assert.equal(order.requiresPayment, false);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productName, 'Toor Dal 1kg');
  assert.equal(order.items[0].unitPrice, '120.00');
  assert.equal(order.shopId, undefined, 'an order is not bound to a shop until a shop accepts');

  const row = await prisma.consumerOrder.findUnique({
    where: { id: order.id },
    include: { payment: true, items: true }
  });
  assert.equal(row.shopId, null);
  assert.equal(row.instructions, 'Ring the bell');
  assert.equal(row.payment.method, 'COD');
  assert.equal(row.payment.status, 'PENDING');
  assert.equal(row.items.length, 1);

  assert.equal(await prisma.cart.count({ where: { id: cartId } }), 0, 'the cart is consumed');

  const shelf = await prisma.shopInventory.findFirst({ where: { shopId: world.shop.id } });
  assert.equal(shelf.reserved, 2);
  assert.equal(shelf.quantity, 10);
});

test('prepaid placement is flagged as awaiting payment', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await cartFor(token, 1);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'PREPAID'
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.order.requiresPayment, true);

  const payment = await prisma.payment.findFirst({ where: { consumerOrderId: res.body.order.id } });
  assert.equal(payment.method, 'PREPAID');
  assert.equal(payment.status, 'PENDING');
});

// --- money -------------------------------------------------------------------

test('tax and delivery fee come from PlatformConfig, never from a constant', async () => {
  await setConfig(CONFIG_KEYS.TAX_PERCENT, '5');
  await setConfig(CONFIG_KEYS.DELIVERY_FEE, '30');

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await cartFor(token, 2);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', tipAmount: '10.50'
  });

  assert.equal(res.body.order.subtotal, '200.00');
  assert.equal(res.body.order.taxAmount, '10.00');
  assert.equal(res.body.order.deliveryFee, '30.00');
  assert.equal(res.body.order.tipAmount, '10.50');
  assert.equal(res.body.order.grandTotal, '250.50');
});

test('money survives the round trip to the paisa, not as a float', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: '0.10' });
  await cartFor(token, 3);

  const res = await place(token, { shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD' });
  // 0.1 + 0.1 + 0.1 as a JS float is 0.30000000000000004.
  assert.equal(res.body.order.grandTotal, '0.30');
});

// --- coupons -----------------------------------------------------------------

async function makeCoupon(overrides = {}) {
  return prisma.coupon.create({
    data: {
      code: 'FLAT50',
      title: 'Flat ₹50 Off',
      discountType: 'FLAT',
      discountValue: 50,
      minOrderValue: 100,
      validFrom: new Date(Date.now() - 86400000),
      validTo: new Date(Date.now() + 86400000),
      ...overrides
    }
  });
}

test('a valid flat coupon reduces the grand total', async () => {
  await makeCoupon();
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 200 });
  await cartFor(token, 1);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode: 'flat50'
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.order.discountAmount, '50.00');
  assert.equal(res.body.order.grandTotal, '150.00');
});

test('a percent coupon is capped by maxDiscount', async () => {
  await makeCoupon({ code: 'PCT20', discountType: 'PERCENT', discountValue: 20, maxDiscount: 30 });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 500 });
  await cartFor(token, 1);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode: 'PCT20'
  });
  assert.equal(res.body.order.discountAmount, '30.00'); // not 100
});

test('a coupon below its minimum order value is rejected', async () => {
  await makeCoupon({ minOrderValue: 500 });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await cartFor(token, 1);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode: 'FLAT50'
  });
  assert.equal(res.status, 400);
  assert.equal(await prisma.consumerOrder.count(), 0, 'a bad coupon must not place the order anyway');
});

test('an expired, inactive or unknown coupon is rejected', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 200 });

  await makeCoupon({ code: 'EXPIRED', validTo: new Date(Date.now() - 1000) });
  await makeCoupon({ code: 'OFF', isActive: false });

  for (const code of ['EXPIRED', 'OFF', 'NOPE']) {
    await cartFor(token, 1);
    const res = await place(token, {
      shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode: code
    });
    assert.equal(res.status, 400, `coupon ${code} should have been rejected`);
  }
});

test('a coupon cannot be used more than perUserLimit times', async () => {
  await makeCoupon({ perUserLimit: 1 });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 200 });

  await cartFor(token, 1);
  assert.equal((await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode: 'FLAT50'
  })).status, 201);

  await cartFor(token, 1);
  const second = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode: 'FLAT50'
  });
  assert.equal(second.status, 400);
});

test('a coupon scoped to another shop does not apply', async () => {
  const otherShop = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  await makeCoupon({ shopId: otherShop.id });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 200 });
  await cartFor(token, 1);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode: 'FLAT50'
  });
  assert.equal(res.status, 400);
});

// --- validation --------------------------------------------------------------

test('placement requires a customer token', async () => {
  assert.equal((await request(app).post('/api/customer/orders').send({})).status, 401);
});

test('an empty or missing cart cannot be placed', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  const res = await place(token, { shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD' });
  assert.equal(res.status, 400);
});

test('another customer\'s address cannot be used', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  await cartFor(token, 1);

  const stranger = await createCustomer();
  const strangerAddress = await createAddress({ customerId: stranger.id, latitude: LAT, longitude: LNG });

  const res = await place(token, {
    shopId: world.shop.id, addressId: strangerAddress.id, paymentMethod: 'COD'
  });
  assert.equal(res.status, 404);
  assert.equal(await prisma.consumerOrder.count(), 0);
});

test('an unserviceable address is refused before any reservation happens', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  await cartFor(token, 1);

  const faraway = await createAddress({
    customerId: customer.id, latitude: LAT + 1, longitude: LNG, isDefault: false
  });

  const res = await place(token, { shopId: world.shop.id, addressId: faraway.id, paymentMethod: 'COD' });
  assert.equal(res.status, 422);
  assert.equal((await prisma.shopInventory.findFirst({ where: { shopId: world.shop.id } })).reserved, 0);
});

test('an unknown payment method is rejected', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10 });
  await cartFor(token, 1);

  const res = await place(token, {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'BITCOIN'
  });
  assert.equal(res.status, 400);
});

// --- reading orders back -----------------------------------------------------

test('a customer sees only their own orders', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await cartFor(token, 1);
  const placed = await place(token, { shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD' });

  const list = await as(token).get('/api/customer/orders');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.orders.map((o) => o.id), [placed.body.order.id]);

  const stranger = customerTokenFor(await createCustomer());
  assert.deepEqual((await as(stranger).get('/api/customer/orders')).body.orders, []);
  assert.equal((await as(stranger).get(`/api/customer/orders/${placed.body.order.id}`)).status, 404);
});

test('order detail returns the bill panel and the items', async () => {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await cartFor(token, 2);
  const placed = await place(token, { shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD' });

  const res = await as(token).get(`/api/customer/orders/${placed.body.order.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.order.subtotal, '200.00');
  assert.equal(res.body.order.items.length, 1);
  assert.equal(res.body.order.address.id, address.id);
});
