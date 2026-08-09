// Auto-applied coupons (PHASE C) — an offer with no code to type.
//
// The flag is small; what it must not do is large. An auto-applied coupon is
// reached differently, not validated differently: `resolveAutoCoupon` calls the
// same `resolveCoupon` a typed code goes through, once per candidate, precisely
// so that windows, scopes, minimums and both usage limits cannot drift apart
// between the two paths. The tests below are mostly about that.
//
// The other decision worth pinning: **a typed code always wins.** Somebody given
// a code expects that code, even when the platform thinks another offer is
// worth more to them.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import {
  resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect
} from './helpers/db.js';
import {
  createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';

const LAT = 12.9716;
const LNG = 77.5946;
const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY);
const ahead = (d) => new Date(Date.now() + d * DAY);

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
    name: 'Toor Dal 1kg', industryId: world.industry.id, ownerId: world.master.id
  });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 50, sellingPrice: 100 });
});

after(async () => {
  await disconnect();
});

const coupon = (extra = {}) =>
  prisma.coupon.create({
    data: {
      code: 'AUTO10',
      title: 'Flat ₹10 Off',
      discountType: 'FLAT',
      discountValue: 10,
      minOrderValue: 0,
      validFrom: ago(1),
      validTo: ahead(30),
      autoApply: true,
      ...extra
    }
  });

/** A cart holding `quantity` of the seeded product, ready to place. */
async function cartWith(quantity = 5) {
  const res = await request(app)
    .post('/api/customer/cart/items')
    .set('Authorization', `Bearer ${token}`)
    .send({ shopId: world.shop.id, productId: product.id, quantity });
  assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
  const carts = await request(app)
    .get('/api/customer/cart')
    .set('Authorization', `Bearer ${token}`);
  return carts.body.carts[0];
}

const place = (cartId, body = {}) =>
  request(app)
    .post('/api/customer/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ cartId, addressId: address.id, paymentMethod: 'COD', ...body });

// ── The feature ────────────────────────────────────────────────────────────

test('an auto-apply coupon is applied with no code typed', async () => {
  const c = await coupon({ discountValue: 60 });
  const cart = await cartWith(5); // ₹500

  const res = await place(cart.id);

  assert.equal(res.status, 201);
  assert.equal(res.body.order.discountAmount, '60.00');
  const order = await prisma.consumerOrder.findUnique({ where: { id: res.body.order.id } });
  assert.equal(order.couponId, c.id);
});

test('a coupon that is not flagged is never applied on its own', async () => {
  await coupon({ discountValue: 60, autoApply: false });
  const cart = await cartWith(5);

  const res = await place(cart.id);

  assert.equal(res.status, 201);
  assert.equal(res.body.order.discountAmount, '0.00');
});

test('the best auto-apply offer wins', async () => {
  await coupon({ code: 'SMALL', discountValue: 20 });
  const big = await coupon({ code: 'BIG', discountValue: 75 });
  await coupon({ code: 'MID', discountValue: 50 });
  const cart = await cartWith(5);

  const res = await place(cart.id);

  assert.equal(res.body.order.discountAmount, '75.00');
  const order = await prisma.consumerOrder.findUnique({ where: { id: res.body.order.id } });
  assert.equal(order.couponId, big.id);
});

test('a typed code beats a more generous automatic one', async () => {
  // Somebody given a code expects that code. The platform preferring its own
  // offer would be overriding a promise made elsewhere.
  await coupon({ code: 'AUTOBIG', discountValue: 90 });
  await coupon({ code: 'TYPED', discountValue: 25, autoApply: false });
  const cart = await cartWith(5);

  const res = await place(cart.id, { couponCode: 'TYPED' });

  assert.equal(res.body.order.discountAmount, '25.00');
});

// ── It validates exactly like a typed code ─────────────────────────────────

test('an automatic offer still respects its minimum order value', async () => {
  await coupon({ discountValue: 60, minOrderValue: 999 });
  const cart = await cartWith(5); // ₹500 — short

  const res = await place(cart.id);

  assert.equal(res.status, 201);
  assert.equal(res.body.order.discountAmount, '0.00');
});

test('an automatic offer still respects perUserLimit', async () => {
  // The failure this guards: an auto-apply coupon that ignored the per-customer
  // limit would discount the same customer on every order they ever place.
  const c = await coupon({ discountValue: 60, perUserLimit: 1 });

  const first = await place((await cartWith(5)).id);
  assert.equal(first.body.order.discountAmount, '60.00');

  const second = await place((await cartWith(5)).id);
  assert.equal(second.status, 201);
  assert.equal(second.body.order.discountAmount, '0.00');
  const order = await prisma.consumerOrder.findUnique({ where: { id: second.body.order.id } });
  assert.equal(order.couponId, null);
});

test('an automatic offer still respects its window and its switch', async () => {
  await coupon({ code: 'PAST', discountValue: 60, validFrom: ago(30), validTo: ago(1) });
  await coupon({ code: 'FUTURE', discountValue: 60, validFrom: ahead(5), validTo: ahead(30) });
  await coupon({ code: 'OFF', discountValue: 60, isActive: false });
  const cart = await cartWith(5);

  const res = await place(cart.id);

  assert.equal(res.body.order.discountAmount, '0.00');
});

test('an automatic offer scoped to another shop is not applied', async () => {
  const otherShop = await prisma.user.create({
    data: {
      email: `other-${Date.now()}@test.roadmate`,
      password: 'x', name: 'Other Shop', role: 'SHOP', isActive: true
    }
  });
  await coupon({ discountValue: 60, shopId: otherShop.id });
  const cart = await cartWith(5);

  const res = await place(cart.id);

  assert.equal(res.body.order.discountAmount, '0.00');
});

// ── It never breaks placement ──────────────────────────────────────────────

test('no eligible automatic offer simply means no discount, never an error', async () => {
  await coupon({ discountValue: 60, minOrderValue: 100000 });
  const cart = await cartWith(5);

  const res = await place(cart.id);

  // A code somebody typed and got wrong deserves a message. An offer they never
  // asked for and did not qualify for deserves silence — refusing the order
  // would be a self-inflicted outage.
  assert.equal(res.status, 201);
  assert.equal(res.body.order.discountAmount, '0.00');
});

test('a percent offer is capped by maxDiscount, exactly as a typed one is', async () => {
  await coupon({ discountType: 'PERCENT', discountValue: 50, maxDiscount: 30 });
  const cart = await cartWith(5); // ₹500 → 50% would be ₹250

  const res = await place(cart.id);

  assert.equal(res.body.order.discountAmount, '30.00');
});

// ── The management surface ─────────────────────────────────────────────────

test('the flag is settable and readable from the Master API', async () => {
  const masterToken = tokenFor(world.master);

  const created = await request(app)
    .post('/api/master/coupons')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      code: 'NOCODE', title: 'Automatic ₹25 off',
      discountType: 'FLAT', discountValue: 25,
      validFrom: ago(1).toISOString(), validTo: ahead(30).toISOString(),
      autoApply: true
    });

  assert.equal(created.status, 201);
  assert.equal(created.body.coupon.autoApply, true);

  const off = await request(app)
    .patch(`/api/master/coupons/${created.body.coupon.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ autoApply: false });
  assert.equal(off.body.coupon.autoApply, false);
});

test('the customer offers list marks an automatic offer as one', async () => {
  await coupon({ code: 'AUTOSHOWN', discountValue: 25 });

  const res = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.body.coupons.length, 1);
  assert.equal(res.body.coupons[0].autoApply, true);
});
