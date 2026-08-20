// Phase 1.9 — the four fulfilment types.
//
// `Industry.fulfilmentType` is the only input. What each branch has to prove:
//
//   COOK_AND_DELIVER    the kitchen's clock reaches `promisedEtaMin`, and the
//                       promise is remade against the shop that actually binds
//                       the order — not the one the cart happened to name.
//   VERIFY_AND_DELIVER  no shop sees a pharmacy order before a prescription is
//                       APPROVED, the reservation survives the wait, and
//                       rejection gives the shelf back. Payment and approval are
//                       two independent gates; the second one to clear starts
//                       the accept window.
//   NO_DELIVERY         no address, no reservation, no attempt, no rider, no
//                       DeliveryJob — and yet the money still settles, because
//                       the split is frozen the same way §1.8 freezes it.
//   PICK_AND_DELIVER    unchanged. Every other test file is its regression test.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createIndustry, createShop, createRider, createProduct, stockShop, createCustomer, createAddress
} from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';
import { sweepExpiredAttempts } from '../src/jobs/sweepAttempts.js';
import { runSettlement } from '../src/lib/settlement.js';

const LAT = 12.9716;
const LNG = 77.5946;

// base_eta_min (10) + ceil(0 km × eta_min_per_km) — every shop in this file
// sits on the drop point, so travel time is 0 and the arithmetic stays visible.
const BASE_ETA = 10;

let world;
let master;
let masterToken;
let customer;
let token;
let address;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  master = world.master;
  masterToken = tokenFor(master);

  await createRider({ lastLat: LAT, lastLng: LNG });

  customer = await createCustomer();
  token = customerTokenFor(customer);
  address = await createAddress({ customerId: customer.id, latitude: LAT, longitude: LNG });
});

after(async () => {
  await disconnect();
});

const as = (t) => ({
  post: (path, body) => request(app).post(path).set('Authorization', `Bearer ${t}`).send(body),
  patch: (path, body) => request(app).patch(path).set('Authorization', `Bearer ${t}`).send(body),
  del: (path) => request(app).delete(path).set('Authorization', `Bearer ${t}`),
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${t}`)
});

/** An industry of a given fulfilment type, with one stocked shop in it. */
async function industryWithShop(fulfilmentType, { prepTimeMin = null, sellingPrice = 100 } = {}) {
  const industry = await createIndustry({ name: fulfilmentType, fulfilmentType });
  const shop = await createShop({
    industryId: industry.id, latitude: LAT, longitude: LNG, prepTimeMin
  });
  const product = await createProduct({ industryId: industry.id, ownerId: master.id });
  await stockShop({ shopId: shop.id, productId: product.id, quantity: 10, sellingPrice });

  return { industry, shop, product, shopToken: tokenFor(shop) };
}

/** Fill a cart at `w`'s shop and place it. Returns the placement response. */
async function place(w, { paymentMethod = 'COD', quantity = 2, withAddress = true } = {}) {
  await as(token).post('/api/customer/cart/items', {
    shopId: w.shop.id, productId: w.product.id, quantity
  });
  return as(token).post('/api/customer/orders', {
    shopId: w.shop.id,
    ...(withAddress ? { addressId: address.id } : {}),
    paymentMethod
  });
}

/** A webhook request signed exactly the way Razorpay signs one (§1.8). */
async function payFor(orderId) {
  const rp = await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`);
  const payload = {
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_TEST123', order_id: rp.body.razorpayOrderId } } }
  };
  const body = JSON.stringify(payload);
  const sig = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return request(app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', sig)
    .send(body);
}

const orderById = (id) =>
  prisma.consumerOrder.findUnique({ where: { id }, include: { vouchers: true, attempts: true } });

const reservedAt = async (shopId) =>
  (await prisma.shopInventory.findFirst({ where: { shopId } })).reserved;

// =============================================================================
// COOK_AND_DELIVER — a number, not a state machine
// =============================================================================

test('a restaurant order promises the kitchen time; a grocery order does not', async () => {
  const kitchen = await industryWithShop('COOK_AND_DELIVER', { prepTimeMin: 20 });
  const grocer = await industryWithShop('PICK_AND_DELIVER');

  const cooked = await place(kitchen);
  const picked = await place(grocer);

  assert.equal(cooked.status, 201, JSON.stringify(cooked.body));
  assert.equal(cooked.body.fulfilmentType, 'COOK_AND_DELIVER');
  assert.equal(cooked.body.order.promisedEtaMin, BASE_ETA + 20);

  // Same distance, same config — the entire difference is the kitchen.
  assert.equal(picked.body.order.promisedEtaMin, BASE_ETA);
});

test("a shop's own prep time beats the industry's, and the industry's is the fallback", async () => {
  const withOwn = await industryWithShop('COOK_AND_DELIVER', { prepTimeMin: 5 });
  const withoutOwn = await industryWithShop('COOK_AND_DELIVER');
  await setConfig(CONFIG_KEYS.PREP_TIME_MIN, 25, withoutOwn.industry.id);

  assert.equal((await place(withOwn)).body.order.promisedEtaMin, BASE_ETA + 5);
  assert.equal((await place(withoutOwn)).body.order.promisedEtaMin, BASE_ETA + 25);
});

test('the ETA is remade against the shop that actually accepts', async () => {
  const kitchen = await industryWithShop('COOK_AND_DELIVER', { prepTimeMin: 10 });
  const placed = await place(kitchen);
  assert.equal(placed.body.order.promisedEtaMin, BASE_ETA + 10);

  // The kitchen is backed up by the time it answers. Placement's promise was
  // made against the *first candidate*; binding is when a real shop commits.
  await prisma.user.update({ where: { id: kitchen.shop.id }, data: { prepTimeMin: 40 } });

  const accepted = await as(kitchen.shopToken).post(
    `/api/shop/offers/${placed.body.order.id}/accept`
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.order.promisedEtaMin, BASE_ETA + 40);
});

test('travel distance is in the ETA, so a far shop promises a later one', async () => {
  const near = await industryWithShop('PICK_AND_DELIVER');
  // ~5 km north of the drop point, inside the shop's own 5 km radius.
  const far = await industryWithShop('PICK_AND_DELIVER');
  await prisma.user.update({ where: { id: far.shop.id }, data: { latitude: LAT + 0.04 } });

  const nearEta = (await place(near)).body.order.promisedEtaMin;
  const farEta = (await place(far)).body.order.promisedEtaMin;

  assert.equal(nearEta, BASE_ETA);
  assert.ok(farEta > nearEta, `expected the far shop to promise later, got ${farEta} vs ${nearEta}`);
});

// =============================================================================
// VERIFY_AND_DELIVER — the gate in front of routing
// =============================================================================

test('a pharmacy order reaches no shop inbox until the prescription is approved', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  const placed = await place(pharmacy);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));

  const order = await orderById(placed.body.order.id);
  // PLACED, not ROUTING: the attempt row exists only to record whose shelf is
  // holding the stock, exactly as it does for an unpaid prepaid order (§1.5).
  assert.equal(order.status, 'PLACED');
  assert.equal(order.attempts.length, 1);
  assert.equal(order.attempts[0].status, 'OFFERED');

  const offers = await as(pharmacy.shopToken).get('/api/shop/offers');
  assert.equal(offers.body.offers.length, 0);

  const accept = await as(pharmacy.shopToken).post(`/api/shop/offers/${order.id}/accept`);
  assert.equal(accept.status, 409);

  // And the reservation is held throughout the wait — the pharmacy must not
  // sell the same box to a walk-in customer while verification is pending.
  assert.equal(await reservedAt(pharmacy.shop.id), 2);
});

test('the sweeper cannot time out an order that is still behind its gate', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  const placed = await place(pharmacy);

  // An hour later: long past any accept window.
  const swept = await sweepExpiredAttempts({ now: new Date(Date.now() + 3600_000) });
  assert.equal(swept.rerouted, 0);
  assert.equal(swept.cancelled, 0);

  const order = await orderById(placed.body.order.id);
  assert.equal(order.status, 'PLACED');
  assert.equal(order.attempts[0].status, 'OFFERED');
});

test('approval opens the window, and the shop can then accept', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  const orderId = (await place(pharmacy)).body.order.id;

  const upload = await as(token).post(`/api/customer/orders/${orderId}/prescription`, {
    imageUrl: 'https://example.test/rx/1.jpg'
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  assert.equal(upload.body.prescription.status, 'UPLOADED');

  // Still gated: uploading is not approving.
  assert.equal((await orderById(orderId)).status, 'PLACED');

  const queue = await as(masterToken).get('/api/pharmacy/prescriptions');
  assert.equal(queue.body.prescriptions.length, 1);

  const approve = await as(masterToken).post(
    `/api/pharmacy/prescriptions/${upload.body.prescription.id}/approve`
  );
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(approve.body.routingStarted, true);

  assert.equal((await orderById(orderId)).status, 'ROUTING');
  const offers = await as(pharmacy.shopToken).get('/api/shop/offers');
  assert.equal(offers.body.offers.length, 1);
  assert.equal((await as(pharmacy.shopToken).post(`/api/shop/offers/${orderId}/accept`)).status, 200);
});

test('rejecting the prescription cancels the order and hands the shelf back', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  const orderId = (await place(pharmacy)).body.order.id;
  const { body } = await as(token).post(`/api/customer/orders/${orderId}/prescription`, {
    imageUrl: 'https://example.test/rx/2.jpg'
  });

  const res = await as(masterToken).post(
    `/api/pharmacy/prescriptions/${body.prescription.id}/reject`,
    { reason: 'Illegible' }
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.orderCancelled, true);

  const order = await orderById(orderId);
  assert.equal(order.status, 'CANCELLED');
  assert.match(order.cancelReason, /Illegible/);
  // The whole reason this cancellation exists: nobody is coming for that stock.
  assert.equal(await reservedAt(pharmacy.shop.id), 0);

  const payment = await prisma.payment.findUnique({ where: { consumerOrderId: orderId } });
  assert.equal(payment.status, 'FAILED'); // COD — never collected, so never refunded

  const customerView = await as(token).get(`/api/customer/orders/${orderId}`);
  assert.equal(customerView.body.order.prescriptions[0].status, 'REJECTED');
  assert.equal(customerView.body.order.prescriptions[0].rejectReason, 'Illegible');
});

test('two verifiers answering at once verify exactly once', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  const orderId = (await place(pharmacy)).body.order.id;
  const { body } = await as(token).post(`/api/customer/orders/${orderId}/prescription`, {
    imageUrl: 'https://example.test/rx/3.jpg'
  });
  const id = body.prescription.id;

  assert.equal((await as(masterToken).post(`/api/pharmacy/prescriptions/${id}/approve`)).status, 200);
  // A second verifier's tap must not re-approve, and must not reject either.
  assert.equal((await as(masterToken).post(`/api/pharmacy/prescriptions/${id}/approve`)).status, 409);
  assert.equal((await as(masterToken).post(`/api/pharmacy/prescriptions/${id}/reject`)).status, 409);

  assert.equal((await orderById(orderId)).status, 'ROUTING');
});

test('payment and approval are independent gates — the second one to clear starts routing', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  const orderId = (await place(pharmacy, { paymentMethod: 'PREPAID' })).body.order.id;

  const { body } = await as(token).post(`/api/customer/orders/${orderId}/prescription`, {
    imageUrl: 'https://example.test/rx/4.jpg'
  });
  const approve = await as(masterToken).post(
    `/api/pharmacy/prescriptions/${body.prescription.id}/approve`
  );

  // Approved, but not paid: the pharmacy still must not see it.
  assert.equal(approve.body.routingStarted, false);
  assert.equal((await orderById(orderId)).status, 'PLACED');
  assert.equal((await as(pharmacy.shopToken).get('/api/shop/offers')).body.offers.length, 0);

  // The webhook is the second gate. Neither door knows about the other.
  assert.equal((await payFor(orderId)).status, 200);
  assert.equal((await orderById(orderId)).status, 'ROUTING');
  assert.equal((await as(pharmacy.shopToken).get('/api/shop/offers')).body.offers.length, 1);
});

test('a prescription can only be attached to your own pharmacy order', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  const grocer = await industryWithShop('PICK_AND_DELIVER');

  const rxOrderId = (await place(pharmacy)).body.order.id;
  const groceryOrderId = (await place(grocer)).body.order.id;

  // Wrong industry: nothing to verify.
  assert.equal(
    (await as(token).post(`/api/customer/orders/${groceryOrderId}/prescription`, {
      imageUrl: 'https://example.test/rx/5.jpg'
    })).status,
    400
  );

  // Someone else's order is a 404 — the caller learns nothing about ids that
  // are not theirs.
  const stranger = customerTokenFor(await createCustomer());
  assert.equal(
    (await as(stranger).post(`/api/customer/orders/${rxOrderId}/prescription`, {
      imageUrl: 'https://example.test/rx/6.jpg'
    })).status,
    404
  );

  // And the image must be a real http(s) URL.
  assert.equal(
    (await as(token).post(`/api/customer/orders/${rxOrderId}/prescription`, {
      imageUrl: 'javascript:alert(1)'
    })).status,
    400
  );
});

test('the verification queue is closed to shops and customers', async () => {
  const pharmacy = await industryWithShop('VERIFY_AND_DELIVER');
  assert.equal((await as(pharmacy.shopToken).get('/api/pharmacy/prescriptions')).status, 403);
  assert.equal((await as(token).get('/api/pharmacy/prescriptions')).status, 401);
});

// =============================================================================
// NO_DELIVERY — a different shape, deliberately
// =============================================================================

test('a membership needs no address, reserves nothing and opens no attempt', async () => {
  const gym = await industryWithShop('NO_DELIVERY');

  const res = await place(gym, { paymentMethod: 'PREPAID', withAddress: false });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.fulfilmentType, 'NO_DELIVERY');
  assert.equal(res.body.order.promisedEtaMin, null);
  assert.equal(res.body.order.firstCandidateShop, undefined);

  const order = await orderById(res.body.order.id);
  assert.equal(order.addressId, null);
  // Bound at placement: you join *that* gym. Nothing to route, nothing to
  // reroute to, so no `FulfilmentAttempt` exists at all.
  assert.equal(order.shopId, gym.shop.id);
  assert.equal(order.attempts.length, 0);
  assert.equal(await reservedAt(gym.shop.id), 0);
});

test('a membership must be paid online — cash at the gym is not the platform’s money', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  const res = await place(gym, { paymentMethod: 'COD', withAddress: false });

  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'PREPAID_REQUIRED');
  assert.equal(await prisma.consumerOrder.count(), 0);
});

test('paying issues the voucher, finalises the sale and freezes the split', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  const orderId = (await place(gym, { paymentMethod: 'PREPAID', withAddress: false })).body.order.id;

  assert.equal((await payFor(orderId)).status, 200);

  const order = await orderById(orderId);
  // DELIVERED is this codebase's word for "the sale is final" — it is what
  // freezes the split (§1.8) and what settlement pays out from. Issuing the
  // voucher *is* the fulfilment.
  assert.equal(order.status, 'DELIVERED');
  assert.ok(order.deliveredAt);
  assert.equal(order.grandTotal.toFixed(2), '200.00');
  assert.equal(order.platformCommission.toFixed(2), '30.00'); // 15%
  assert.equal(order.shopPayable.toFixed(2), '170.00');

  assert.equal(order.vouchers.length, 1);
  assert.match(order.vouchers[0].code, /^RM-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.ok(order.vouchers[0].validTo > order.vouchers[0].validFrom);

  // No rider was ever involved, and no shelf moved.
  assert.equal(await prisma.deliveryJob.count(), 0);
  assert.equal(await reservedAt(gym.shop.id), 0);
  assert.equal((await prisma.shopInventory.findFirst({ where: { shopId: gym.shop.id } })).quantity, 10);

  const view = await as(token).get(`/api/customer/orders/${orderId}`);
  assert.equal(view.body.order.vouchers[0].code, order.vouchers[0].code);
  assert.equal(view.body.order.vouchers[0].isRedeemed, false);
});

test('a replayed webhook does not mint a second voucher', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  const orderId = (await place(gym, { paymentMethod: 'PREPAID', withAddress: false })).body.order.id;

  await payFor(orderId);
  await payFor(orderId);

  assert.equal(await prisma.voucher.count({ where: { consumerOrderId: orderId } }), 1);
});

test('the shop redeems a voucher exactly once', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  const orderId = (await place(gym, { paymentMethod: 'PREPAID', withAddress: false })).body.order.id;
  await payFor(orderId);
  const { code } = (await orderById(orderId)).vouchers[0];

  const lookup = await as(gym.shopToken).get(`/api/shop/vouchers/${code}`);
  assert.equal(lookup.status, 200, JSON.stringify(lookup.body));
  assert.equal(lookup.body.voucher.isRedeemed, false);

  const first = await as(gym.shopToken).post('/api/shop/vouchers/redeem', { code });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.voucher.redeemedAt);

  // A double tap at the counter is a 409, not a second redemption.
  const second = await as(gym.shopToken).post('/api/shop/vouchers/redeem', { code });
  assert.equal(second.status, 409);
  assert.equal(second.body.reason, 'ALREADY_REDEEMED');

  const stored = await prisma.voucher.findUnique({ where: { code } });
  assert.equal(stored.redeemedByShopId, gym.shop.id);
});

test('another shop cannot redeem, and an unknown code is a 404', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  const rivalGym = await industryWithShop('NO_DELIVERY');

  const orderId = (await place(gym, { paymentMethod: 'PREPAID', withAddress: false })).body.order.id;
  await payFor(orderId);
  const { code } = (await orderById(orderId)).vouchers[0];

  const rival = await as(rivalGym.shopToken).post('/api/shop/vouchers/redeem', { code });
  assert.equal(rival.status, 403);
  assert.equal(rival.body.reason, 'WRONG_SHOP');
  // A rival cannot even look it up.
  assert.equal((await as(rivalGym.shopToken).get(`/api/shop/vouchers/${code}`)).status, 404);

  assert.equal(
    (await as(gym.shopToken).post('/api/shop/vouchers/redeem', { code: 'RM-NOPE-NOPE1' })).status,
    404
  );
  assert.equal((await prisma.voucher.findUnique({ where: { code } })).redeemedAt, null);
});

test('an expired voucher is refused', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  const orderId = (await place(gym, { paymentMethod: 'PREPAID', withAddress: false })).body.order.id;
  await payFor(orderId);
  const { code } = (await orderById(orderId)).vouchers[0];

  await prisma.voucher.update({
    where: { code },
    data: { validTo: new Date(Date.now() - 1000) }
  });

  const res = await as(gym.shopToken).post('/api/shop/vouchers/redeem', { code });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'EXPIRED');
});

test('voucher validity falls back to config, per industry', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  await setConfig(CONFIG_KEYS.VOUCHER_VALIDITY_DAYS, 90, gym.industry.id);

  const orderId = (await place(gym, { paymentMethod: 'PREPAID', withAddress: false })).body.order.id;
  await payFor(orderId);

  const voucher = (await orderById(orderId)).vouchers[0];
  const days = (voucher.validTo - voucher.validFrom) / 86_400_000;
  assert.ok(Math.abs(days - 90) < 0.01, `expected 90 days of validity, got ${days}`);
});

/**
 * A membership variant — "3 Months", priced by the shop on its own shelf and
 * timed by `ProductVariant.validityDays`. Both halves of the client's answer
 * ("the shop sets price and duration") in one row.
 */
async function membershipVariant(gym, { label = '3 Months', validityDays = 90, sellingPrice = 4500 } = {}) {
  const variant = await prisma.productVariant.create({
    data: { label, price: sellingPrice, validityDays, productId: gym.product.id }
  });
  await stockShop({
    shopId: gym.shop.id, productId: gym.product.id, variantId: variant.id, quantity: 10, sellingPrice
  });
  return variant;
}

/** Place an order for one specific variant. */
async function placeVariant(gym, variantId) {
  await as(token).post('/api/customer/cart/items', {
    shopId: gym.shop.id, productId: gym.product.id, variantId, quantity: 1
  });
  return as(token).post('/api/customer/orders', { shopId: gym.shop.id, paymentMethod: 'PREPAID' });
}

test('the variant sets the membership duration, and beats the config fallback', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  // The config says 30 — the assumption PLAN §7.4 flagged as the one invented
  // number in the codebase. What the customer bought says 90.
  await setConfig(CONFIG_KEYS.VOUCHER_VALIDITY_DAYS, 30, gym.industry.id);
  const variant = await membershipVariant(gym, { validityDays: 90 });

  const placed = await placeVariant(gym, variant.id);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  await payFor(placed.body.order.id);

  const voucher = (await orderById(placed.body.order.id)).vouchers[0];
  const days = (voucher.validTo - voucher.validFrom) / 86_400_000;
  assert.ok(Math.abs(days - 90) < 0.01, `expected the variant's 90 days, got ${days}`);
});

test('a variant that declares no duration still falls back to config', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  await setConfig(CONFIG_KEYS.VOUCHER_VALIDITY_DAYS, 45, gym.industry.id);
  const variant = await membershipVariant(gym, { label: 'Day Pass', validityDays: null });

  const placed = await placeVariant(gym, variant.id);
  await payFor(placed.body.order.id);

  const voucher = (await orderById(placed.body.order.id)).vouchers[0];
  const days = (voucher.validTo - voucher.validFrom) / 86_400_000;
  assert.ok(Math.abs(days - 45) < 0.01, `expected the fallback 45 days, got ${days}`);
});

test('a membership settles like any other sale, with no shopId assumption broken', async () => {
  const gym = await industryWithShop('NO_DELIVERY');
  const orderId = (await place(gym, { paymentMethod: 'PREPAID', withAddress: false })).body.order.id;
  await payFor(orderId);

  const periodStart = new Date(Date.now() - 86_400_000);
  const periodEnd = new Date(Date.now() + 86_400_000);
  const run = await runSettlement({ periodStart, periodEnd });

  assert.equal(run.shopCount, 1);
  const [settlement] = run.settlements;
  assert.equal(settlement.shopId, gym.shop.id);
  assert.equal(settlement.grossSales.toFixed(2), '200.00');
  assert.equal(settlement.commission.toFixed(2), '30.00');
  // Prepaid, so the platform already holds the cash — nothing was collected in
  // a rider's hand, and there is no rider to have collected it.
  assert.equal(settlement.codCollected.toFixed(2), '0.00');
  assert.equal(settlement.netPayable.toFixed(2), '170.00');
});

// =============================================================================
// SERVICE_BOOKING — a turf hour
//
// It inherits every NO_DELIVERY property above (no address, no reservation, no
// attempt, no rider, prepaid-only, settles at issue), so what is worth testing
// here is only the difference: the slot is held, it cannot be oversold, and the
// voucher is valid for the booked hour rather than for a month from purchase.
// =============================================================================

const HOUR = 60 * 60 * 1000;

/** A turf, with one bookable hour tomorrow evening. */
async function turfWithSlot({ capacity = 1, priceOverride = null, startsInMs = 24 * HOUR } = {}) {
  const w = await industryWithShop('SERVICE_BOOKING', { sellingPrice: 800 });
  const startsAt = new Date(Date.now() + startsInMs);
  const slot = await prisma.serviceSlot.create({
    data: {
      shopId: w.shop.id,
      productId: w.product.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      capacity,
      priceOverride
    }
  });
  return { ...w, slot };
}

/** Book `w`'s slot. A booking needs no address and must be prepaid. */
const book = async (w, { slotId = w.slot.id, quantity = 1 } = {}) => {
  await as(token).post('/api/customer/cart/items', {
    shopId: w.shop.id, productId: w.product.id, quantity
  });
  return as(token).post('/api/customer/orders', {
    shopId: w.shop.id,
    slotId,
    paymentMethod: 'PREPAID'
  });
};

const slotById = (id) => prisma.serviceSlot.findUnique({ where: { id } });

test('a booking holds its slot, takes no address and reserves no stock', async () => {
  const turf = await turfWithSlot();
  const res = await book(turf);

  assert.equal(res.status, 201);
  assert.equal(res.body.fulfilmentType, 'SERVICE_BOOKING');

  const order = await orderById(res.body.order.id);
  assert.equal(order.addressId, null);
  assert.equal(order.slotId, turf.slot.id);
  // Bound at placement and never rerouted — you book *that* turf.
  assert.equal(order.shopId, turf.shop.id);
  assert.equal(order.attempts.length, 0);
  assert.equal(await reservedAt(turf.shop.id), 0);

  assert.equal((await slotById(turf.slot.id)).booked, 1);
});

test('a booking must be paid online, exactly like a membership', async () => {
  const turf = await turfWithSlot();
  await as(token).post('/api/customer/cart/items', {
    shopId: turf.shop.id, productId: turf.product.id, quantity: 1
  });
  const res = await as(token).post('/api/customer/orders', {
    shopId: turf.shop.id, slotId: turf.slot.id, paymentMethod: 'COD'
  });

  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'PREPAID_REQUIRED');
  assert.equal((await slotById(turf.slot.id)).booked, 0);
});

test('a booking without a slot is refused before any money is computed', async () => {
  const turf = await turfWithSlot();
  await as(token).post('/api/customer/cart/items', {
    shopId: turf.shop.id, productId: turf.product.id, quantity: 1
  });
  const res = await as(token).post('/api/customer/orders', {
    shopId: turf.shop.id, paymentMethod: 'PREPAID'
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'SLOT_REQUIRED');
  assert.equal(await prisma.consumerOrder.count(), 0);
});

test('the last place in a slot is sold once, not twice', async () => {
  const turf = await turfWithSlot({ capacity: 1 });
  assert.equal((await book(turf)).status, 201);

  // A second customer, so the first one's cart is not the thing in the way.
  const other = await createCustomer();
  const otherToken = customerTokenFor(other);
  await as(otherToken).post('/api/customer/cart/items', {
    shopId: turf.shop.id, productId: turf.product.id, quantity: 1
  });
  const res = await as(otherToken).post('/api/customer/orders', {
    shopId: turf.shop.id, slotId: turf.slot.id, paymentMethod: 'PREPAID'
  });

  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'SLOT_FULL');
  assert.equal((await slotById(turf.slot.id)).booked, 1);
});

test('an hour that has already started cannot be booked', async () => {
  const turf = await turfWithSlot({ startsInMs: -HOUR });
  const res = await book(turf);

  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'SLOT_PASSED');
});

test("a slot's price override is what the customer is charged", async () => {
  // The shelf says 800; Saturday evening says 1200. The shelf must not win.
  const turf = await turfWithSlot({ priceOverride: 1200 });
  const res = await book(turf);

  assert.equal(res.status, 201);
  const order = await prisma.consumerOrder.findUnique({ where: { id: res.body.order.id } });
  assert.equal(order.subtotal.toFixed(2), '1200.00');
});

test("the voucher is valid for the booked hour, not for a month from purchase", async () => {
  const turf = await turfWithSlot();
  const res = await book(turf);
  await payFor(res.body.order.id);

  const order = await orderById(res.body.order.id);
  // Issuing the voucher IS the fulfilment, so the sale is final (§1.9).
  assert.equal(order.status, 'DELIVERED');
  assert.equal(order.vouchers.length, 1);

  const voucher = order.vouchers[0];
  assert.equal(voucher.validFrom.toISOString(), turf.slot.startsAt.toISOString());
  assert.equal(voucher.validTo.toISOString(), turf.slot.endsAt.toISOString());
});

test('a booking code will not open the gate before its hour', async () => {
  const turf = await turfWithSlot();
  const res = await book(turf);
  await payFor(res.body.order.id);

  const order = await orderById(res.body.order.id);
  const redeemed = await as(turf.shopToken).post('/api/shop/vouchers/redeem', {
    code: order.vouchers[0].code
  });

  // The gym counter's screen, unchanged, now saying "you're early" for a turf.
  assert.equal(redeemed.status, 409);
  assert.equal(redeemed.body.reason, 'NOT_YET_VALID');
});

test('an abandoned booking gives its hour back', async () => {
  const turf = await turfWithSlot();
  const res = await book(turf);
  assert.equal((await slotById(turf.slot.id)).booked, 1);

  const { cancelPlacedOrder } = await import('../src/lib/routing.js');
  const cancelled = await cancelPlacedOrder(res.body.order.id, { reason: 'Never paid.' });

  assert.equal(cancelled.cancelled, true);
  assert.equal((await slotById(turf.slot.id)).booked, 0);
});

// --- the venue's calendar -----------------------------------------------------

test('a venue opens an evening in one call, and re-running it adds no duplicates', async () => {
  const turf = await turfWithSlot();
  const opensAt = new Date(Date.now() + 48 * HOUR);
  const closesAt = new Date(opensAt.getTime() + 4 * HOUR);

  const body = { productId: turf.product.id, opensAt, closesAt, slotMinutes: 60, capacity: 2 };
  const first = await as(turf.shopToken).post('/api/shop/slots', body);
  assert.equal(first.status, 201);
  assert.equal(first.body.created, 4);

  const again = await as(turf.shopToken).post('/api/shop/slots', body);
  assert.equal(again.body.created, 0);
  assert.equal(again.body.skipped, 4);
});

test('a booked hour can be closed but not deleted', async () => {
  const turf = await turfWithSlot();
  await book(turf);

  // Deleting it would take the calendar entry out from under a customer holding
  // a paid voucher whose whole meaning is the hour it names.
  const removed = await as(turf.shopToken).del(`/api/shop/slots/${turf.slot.id}`);
  assert.equal(removed.status, 409);
  assert.equal(removed.body.reason, 'SLOT_HAS_BOOKINGS');

  const closed = await as(turf.shopToken).patch(`/api/shop/slots/${turf.slot.id}`, { isOpen: false });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.slot.isBookable, false);
  assert.equal((await slotById(turf.slot.id)).booked, 1);
});

test("capacity cannot be cut below what is already booked", async () => {
  const turf = await turfWithSlot({ capacity: 2 });
  await book(turf);

  const res = await as(turf.shopToken).patch(`/api/shop/slots/${turf.slot.id}`, { capacity: 1 });
  assert.equal(res.status, 200); // 1 booked, capacity 1 — allowed

  const tooFar = await as(turf.shopToken).patch(`/api/shop/slots/${turf.slot.id}`, { capacity: 0 });
  assert.equal(tooFar.status, 400);
});

test("the customer's calendar shows a full hour rather than hiding it", async () => {
  const turf = await turfWithSlot({ capacity: 1 });
  await book(turf);

  const res = await as(token).get(`/api/customer/shops/${turf.shop.id}/slots`);
  assert.equal(res.status, 200);
  assert.equal(res.body.slots.length, 1);
  assert.equal(res.body.slots[0].isBookable, false);
  assert.equal(res.body.slots[0].placesLeft, 0);
});
