// Coupon management (PHASE A.3).
//
// The model has been complete since Phase 0 and `resolveCoupon()` has applied it
// at checkout since §1.4. What was missing was any way to *make* one — no API,
// no screen, SQL only — which in practice means no coupon has ever existed and
// the entire discount half of the platform was unreachable.
//
// The two rules worth pinning, and the reason each exists:
//
//   • A USED COUPON IS NEVER DELETED. `ConsumerOrder.couponId` is the recorded
//     reason a delivered order was discounted, and that order's money was frozen
//     at delivery. Deleting it orphans the explanation for a settled payout.
//
//   • THE CUSTOMER LIST NEVER PROMISES. `resolveCoupon` remains the authority at
//     checkout; this endpoint only hides what is *certainly* unusable. In
//     particular it does not filter on `minOrderValue`, because a customer ₹40
//     short should be told to add ₹40 of items, not shown nothing.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import {
  resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect
} from './helpers/db.js';
import { createShop, createCustomer, createIndustry } from './helpers/factories.js';

let world;
let masterToken;
let customer;
let customerToken;

const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY);
const ahead = (d) => new Date(Date.now() + d * DAY);

const valid = (extra = {}) => ({
  code: 'SAVE50',
  title: 'Flat ₹50 Off',
  subtitle: 'Above ₹299',
  discountType: 'FLAT',
  discountValue: 50,
  minOrderValue: 299,
  validFrom: ago(1).toISOString(),
  validTo: ahead(30).toISOString(),
  ...extra
});

const create = (body, token = masterToken) =>
  request(app).post('/api/master/coupons').set('Authorization', `Bearer ${token}`).send(body);

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  masterToken = tokenFor(world.master);
  customer = await createCustomer();
  customerToken = customerTokenFor(customer);
});

after(async () => {
  await disconnect();
});

/** A delivered order that claimed a coupon — the thing usage counts count. */
let orderSeq = 0;
const orderUsing = (couponId, customerId) =>
  prisma.consumerOrder.create({
    data: {
      orderNumber: `CO-TEST-${(orderSeq += 1)}-${Date.now()}`,
      customerId,
      industryId: world.industry.id,
      couponId,
      status: 'DELIVERED',
      subtotal: 500, discountAmount: 10, grandTotal: 490
    }
  });

/** A coupon row, straight in, for tests about reading rather than writing. */
const seedCoupon = (extra = {}) =>
  prisma.coupon.create({
    data: {
      code: 'SEED10',
      title: 'Flat ₹10 Off',
      discountType: 'FLAT',
      discountValue: 10,
      minOrderValue: 0,
      validFrom: ago(1),
      validTo: ahead(30),
      ...extra
    }
  });

// ── Creating ───────────────────────────────────────────────────────────────

test('a coupon can be created, and comes back with its usage count', async () => {
  const res = await create(valid());

  assert.equal(res.status, 201);
  assert.equal(res.body.coupon.code, 'SAVE50');
  assert.equal(res.body.coupon.discountValue, '50.00');
  assert.equal(res.body.coupon.minOrderValue, '299.00');
  assert.equal(res.body.coupon.timesUsed, 0);
  assert.equal(res.body.coupon.phase, 'LIVE');
});

test('a code is uppercased on the way in', async () => {
  // `resolveCoupon` uppercases what the customer types, so a lowercase row is a
  // coupon nobody could ever redeem.
  const res = await create(valid({ code: 'save50' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.coupon.code, 'SAVE50');
});

test('a duplicate code is a 409, not a 500', async () => {
  await create(valid());
  const res = await create(valid({ title: 'Another' }));

  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'CODE_TAKEN');
});

test('a percentage over 100 is refused rather than silently clamped', async () => {
  // `discountFor()` does clamp at the subtotal — which is exactly the problem:
  // a coupon somebody typed wrong would work, quietly, and nobody would know.
  const res = await create(valid({ discountType: 'PERCENT', discountValue: 150 }));

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'INVALID_COUPON');
});

test('a window that ends before it starts is refused', async () => {
  const res = await create(valid({ validFrom: ahead(10).toISOString(), validTo: ahead(2).toISOString() }));
  assert.equal(res.status, 400);
});

test('a zero or negative discount is refused', async () => {
  for (const discountValue of [0, -20]) {
    const res = await create(valid({ discountValue }));
    assert.equal(res.status, 400, `value ${discountValue}`);
  }
});

test('a malformed code is refused', async () => {
  for (const code of ['AB', 'SAVE 50', 'SAVE-50', '']) {
    const res = await create(valid({ code }));
    assert.equal(res.status, 400, `code "${code}"`);
  }
});

test('a scope naming a row that does not exist is refused', async () => {
  // A coupon scoped to shop 9999 is a coupon nobody can ever use, and nothing
  // downstream would ever report it.
  const res = await create(valid({ shopId: 9999 }));
  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'BAD_SCOPE');
});

test('a blank usage limit means unlimited, and is not stored as 0', async () => {
  const res = await create(valid({ usageLimit: '' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.coupon.usageLimit, null);
});

test('coupons are MASTER only', async () => {
  const res = await create(valid(), tokenFor(world.shop));
  assert.equal(res.status, 403);
});

// ── Phase is derived, never stored ─────────────────────────────────────────

test('phase comes from the clock, not from a column', async () => {
  await seedCoupon({ code: 'PAST', validFrom: ago(30), validTo: ago(1) });
  await seedCoupon({ code: 'FUTURE', validFrom: ahead(5), validTo: ahead(30) });
  await seedCoupon({ code: 'OFF', isActive: false });
  await seedCoupon({ code: 'NOW' });

  const res = await request(app)
    .get('/api/master/coupons')
    .set('Authorization', `Bearer ${masterToken}`);

  assert.equal(res.status, 200);
  const phase = Object.fromEntries(res.body.coupons.map((c) => [c.code, c.phase]));
  assert.equal(phase.PAST, 'EXPIRED');
  assert.equal(phase.FUTURE, 'SCHEDULED');
  assert.equal(phase.OFF, 'WITHDRAWN');
  assert.equal(phase.NOW, 'LIVE');
});

// ── Updating ───────────────────────────────────────────────────────────────

test('moving only the end date is re-checked against the untouched start', async () => {
  const coupon = await seedCoupon({ validFrom: ahead(5), validTo: ahead(30) });

  const res = await request(app)
    .patch(`/api/master/coupons/${coupon.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ validTo: ahead(1).toISOString() });

  assert.equal(res.status, 400);
});

test('changing the type to PERCENT re-checks a value that was fine as FLAT', async () => {
  // ₹150 off is ordinary; 150% is not. The two halves can arrive in separate
  // requests, so the ceiling is checked against the merged result.
  const coupon = await seedCoupon({ discountType: 'FLAT', discountValue: 150 });

  const res = await request(app)
    .patch(`/api/master/coupons/${coupon.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ discountType: 'PERCENT' });

  assert.equal(res.status, 400);
});

test('an offer is withdrawn by switching it off', async () => {
  const coupon = await seedCoupon();

  const res = await request(app)
    .patch(`/api/master/coupons/${coupon.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ isActive: false });

  assert.equal(res.status, 200);
  assert.equal(res.body.coupon.phase, 'WITHDRAWN');
});

// ── Deleting ───────────────────────────────────────────────────────────────

test('an unused coupon can be deleted', async () => {
  const coupon = await seedCoupon();

  const res = await request(app)
    .delete(`/api/master/coupons/${coupon.id}`)
    .set('Authorization', `Bearer ${masterToken}`);

  assert.equal(res.status, 200);
  assert.equal(await prisma.coupon.count(), 0);
});

test('a coupon that has been used is never deleted', async () => {
  const coupon = await seedCoupon();
  await orderUsing(coupon.id, customer.id);

  const res = await request(app)
    .delete(`/api/master/coupons/${coupon.id}`)
    .set('Authorization', `Bearer ${masterToken}`);

  // 409 with a reason, not a foreign-key 500 nobody can read. That order's money
  // was frozen at delivery and this row is the recorded reason for the discount.
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'COUPON_IN_USE');
  assert.equal(res.body.timesUsed, 1);
  assert.equal(await prisma.coupon.count(), 1);
});

// ── What the customer sees ─────────────────────────────────────────────────

test('a customer sees live platform-wide offers', async () => {
  await seedCoupon({ code: 'WELCOME', title: 'Flat ₹100 Off' });

  const res = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${customerToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.coupons.length, 1);
  assert.equal(res.body.coupons[0].code, 'WELCOME');
});

test('a customer never sees a withdrawn, expired or unstarted offer', async () => {
  await seedCoupon({ code: 'OFF', isActive: false });
  await seedCoupon({ code: 'PAST', validFrom: ago(30), validTo: ago(1) });
  await seedCoupon({ code: 'FUTURE', validFrom: ahead(5), validTo: ahead(30) });

  const res = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${customerToken}`);

  assert.deepEqual(res.body.coupons, []);
});

test('one shop’s offer is never advertised on another shop’s page', async () => {
  const other = await createShop({ industryId: world.industry.id, latitude: 12.9, longitude: 77.5 });
  await seedCoupon({ code: 'MINE', shopId: world.shop.id });
  await seedCoupon({ code: 'THEIRS', shopId: other.id });
  await seedCoupon({ code: 'ANYWHERE' });

  const res = await request(app)
    .get('/api/customer/coupons')
    .query({ shopId: world.shop.id })
    .set('Authorization', `Bearer ${customerToken}`);

  const codes = res.body.coupons.map((c) => c.code).sort();
  assert.deepEqual(codes, ['ANYWHERE', 'MINE']);
});

test('an industry-scoped offer only shows for that industry', async () => {
  const other = await createIndustry({ name: 'Pharmacy' });
  await seedCoupon({ code: 'GROCERY', industryId: world.industry.id });
  await seedCoupon({ code: 'PHARMA', industryId: other.id });

  const res = await request(app)
    .get('/api/customer/coupons')
    .query({ industryId: world.industry.id })
    .set('Authorization', `Bearer ${customerToken}`);

  assert.deepEqual(res.body.coupons.map((c) => c.code), ['GROCERY']);
});

test('a coupon this customer has already used is not offered again', async () => {
  const coupon = await seedCoupon({ code: 'ONCE', perUserLimit: 1 });
  await orderUsing(coupon.id, customer.id);

  const mine = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${customerToken}`);
  assert.deepEqual(mine.body.coupons, []);

  // ...but somebody else's first use is unaffected. Only the second count is
  // per-customer, and conflating them would withdraw the offer platform-wide
  // the moment one person used it.
  const someoneElse = customerTokenFor(await createCustomer());
  const theirs = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${someoneElse}`);
  assert.deepEqual(theirs.body.coupons.map((c) => c.code), ['ONCE']);
});

test('a globally exhausted coupon is offered to nobody', async () => {
  const coupon = await seedCoupon({ code: 'FIRST100', usageLimit: 1 });
  await orderUsing(coupon.id, (await createCustomer()).id);

  const res = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${customerToken}`);

  assert.deepEqual(res.body.coupons, []);
});

test('an offer the cart is too small for is still shown, with its threshold', async () => {
  // Deliberate: a customer ₹40 short should be told to add ₹40 of items. Hiding
  // it makes the offer invisible to exactly the people it exists to move.
  await seedCoupon({ code: 'BIG', minOrderValue: 999 });

  const res = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${customerToken}`);

  assert.equal(res.body.coupons.length, 1);
  assert.equal(res.body.coupons[0].minOrderValue, '999.00');
});

test('the customer list never publishes how many of an offer remain', async () => {
  await seedCoupon({ code: 'LTD', usageLimit: 100, perUserLimit: 3 });

  const res = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${customerToken}`);

  const offer = res.body.coupons[0];
  assert.equal(offer.usageLimit, undefined);
  assert.equal(offer.perUserLimit, undefined);
  assert.equal(offer.timesUsed, undefined);
});

test('the offers list needs a customer token, not a staff one', async () => {
  const res = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${masterToken}`);

  assert.equal(res.status, 401);
});

// ── The list and checkout agree ────────────────────────────────────────────

test('a code taken from the offers list is one resolveCoupon accepts', async () => {
  // The whole point of the endpoint: what it shows must be redeemable. This is
  // the seam where a filter drifting from `resolveCoupon` would show up.
  await seedCoupon({ code: 'REAL20', discountType: 'FLAT', discountValue: 20, minOrderValue: 0 });

  const listed = await request(app)
    .get('/api/customer/coupons')
    .set('Authorization', `Bearer ${customerToken}`);
  const code = listed.body.coupons[0].code;

  const { resolveCoupon } = await import('../src/lib/coupon.js');
  const { Prisma } = await import('@prisma/client');
  const resolved = await resolveCoupon({
    code,
    customerId: customer.id,
    shopId: world.shop.id,
    industryId: world.industry.id,
    subtotal: new Prisma.Decimal('500.00')
  });

  assert.equal(resolved.error, undefined);
  assert.equal(resolved.discount.toFixed(2), '20.00');
});
