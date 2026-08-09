// Free delivery above ₹199 — who actually pays for the drop.
//
// Client call, 2026-08-09. "Free" delivery is free to the CUSTOMER and to
// nobody else:
//
//   · at or above `free_delivery_threshold` of goods, the customer is charged
//     no delivery fee and the SHOP pays the rider — the real ₹25 + ₹8/km,
//     deducted from its weekly settlement;
//   · below it, the customer pays the flat `delivery_fee` and that funds the
//     rider.
//
// ⚠️ **The platform funds neither, and that is the whole point.** Until this
// landed, `deliveryFee` sat inside `grandTotal` and therefore inside
// `shopPayable` — so the platform collected the delivery fee from the customer,
// handed it to the shop, and *still* paid the rider out of its own pocket. A 15%
// commission had been masking that; setting commission to 0 on the same call
// would have made it ruinous.
//
// Two properties this file exists to pin: the threshold is measured on the
// subtotal AFTER any coupon, and the decision is FROZEN at placement rather than
// re-derived later from a config row somebody may since have edited.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import {
  resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect
} from './helpers/db.js';
import {
  createRider, createProduct, stockShop, createCustomer, createAddress, createIndustry
} from './helpers/factories.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';

const LAT = 12.9716;
const LNG = 77.5946;

let world;
let shopToken;
let customer;
let token;
let address;
let product;
let riderToken;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  await prisma.user.update({ where: { id: world.shop.id }, data: { safetyStockBuffer: 100 } });
  shopToken = tokenFor(world.shop);

  customer = await createCustomer();
  token = customerTokenFor(customer);
  address = await createAddress({ customerId: customer.id, latitude: LAT, longitude: LNG });
  product = await createProduct({
    name: 'Toor Dal 1kg', industryId: world.industry.id, ownerId: world.master.id
  });
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 100, sellingPrice: 100 });
  // On shift before anything is placed: placement re-checks serviceability, so
  // a rider created later is a rider that does not exist yet as far as the
  // order is concerned.
  riderToken = tokenFor(await createRider({ lastLat: LAT, lastLng: LNG }));

  // The confirmed numbers.
  await setConfig(CONFIG_KEYS.FREE_DELIVERY_THRESHOLD, '199');
  await setConfig(CONFIG_KEYS.DELIVERY_FEE, '25');
  await setConfig(CONFIG_KEYS.TAX_PERCENT, '0'); // keeps the arithmetic readable
  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, '0');
  await setConfig(CONFIG_KEYS.RIDER_BASE_FEE, '25');
  await setConfig(CONFIG_KEYS.RIDER_FREE_KM, '2');
  await setConfig(CONFIG_KEYS.RIDER_PER_KM_FEE, '8');
});

after(async () => {
  await disconnect();
});

const as = (t) => ({
  post: (path, body) => request(app).post(path).set('Authorization', `Bearer ${t}`).send(body),
  patch: (path, body) => request(app).patch(path).set('Authorization', `Bearer ${t}`).send(body),
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${t}`)
});

/** Place an order for `quantity` × ₹100. */
async function place({ quantity, couponCode } = {}) {
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod: 'COD', couponCode
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  return prisma.consumerOrder.findUnique({ where: { id: placed.body.order.id } });
}

/** Walk an order all the way to delivered, so the split is frozen. */
async function deliver(orderId) {
  await as(shopToken).post(`/api/shop/offers/${orderId}/accept`);
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'PREPARING' });
  await as(shopToken).patch(`/api/shop/orders/${orderId}/status`, { status: 'READY' });

  const job = await prisma.deliveryJob.findFirst({ where: { consumerOrderId: orderId } });
  await as(riderToken).post(`/api/rider/jobs/${job.id}/pickup`);
  const fresh = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  const done = await as(riderToken).post(`/api/rider/jobs/${job.id}/deliver`, {
    otpCode: fresh.otpCode
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));

  return {
    order: await prisma.consumerOrder.findUnique({ where: { id: orderId } }),
    job: await prisma.deliveryJob.findUnique({ where: { id: job.id } })
  };
}

// ── The customer's bill ────────────────────────────────────────────────────

test('an order at or above the threshold is charged no delivery fee', async () => {
  const order = await place({ quantity: 2 }); // ₹200

  assert.equal(Number(order.deliveryFee), 0);
  assert.equal(order.shopFundsDelivery, true);
  assert.equal(Number(order.grandTotal), 200);
});

test('an order below the threshold pays the flat fee', async () => {
  const order = await place({ quantity: 1 }); // ₹100

  assert.equal(Number(order.deliveryFee), 25);
  assert.equal(order.shopFundsDelivery, false);
  assert.equal(Number(order.grandTotal), 125);
});

test('exactly at the threshold counts as above it', async () => {
  await setConfig(CONFIG_KEYS.FREE_DELIVERY_THRESHOLD, '200');
  const order = await place({ quantity: 2 }); // ₹200, exactly

  // "above ₹199" in the client's words, ">= threshold" in the code. A customer
  // landing exactly on the number gets the better answer, which is also what
  // every shop in the market does.
  assert.equal(order.shopFundsDelivery, true);
});

test('the threshold is measured AFTER the coupon', async () => {
  // The client's answer, and it is the one that matters: a ₹250 cart with a ₹60
  // coupon is ₹190 of actual spend, so it pays delivery. Measuring before the
  // coupon would let a discount code buy free delivery as well.
  await prisma.coupon.create({
    data: {
      code: 'SAVE60', title: 'Flat ₹60 off', discountType: 'FLAT', discountValue: 60,
      minOrderValue: 0, validFrom: new Date(Date.now() - 86400000),
      validTo: new Date(Date.now() + 86400000)
    }
  });

  const order = await place({ quantity: 3, couponCode: 'SAVE60' }); // ₹300 − ₹60 = ₹240

  assert.equal(Number(order.discountAmount), 60);
  assert.equal(order.shopFundsDelivery, true); // ₹240 ≥ ₹199

  const smaller = await place({ quantity: 25 }); // separate cart, ₹2500 — sanity
  assert.equal(smaller.shopFundsDelivery, true);
});

test('a coupon that drops the spend below the threshold brings the fee back', async () => {
  await prisma.coupon.create({
    data: {
      code: 'BIG80', title: 'Flat ₹80 off', discountType: 'FLAT', discountValue: 80,
      minOrderValue: 0, validFrom: new Date(Date.now() - 86400000),
      validTo: new Date(Date.now() + 86400000)
    }
  });

  const order = await place({ quantity: 2, couponCode: 'BIG80' }); // ₹200 − ₹80 = ₹120

  assert.equal(order.shopFundsDelivery, false);
  assert.equal(Number(order.deliveryFee), 25);
});

test('a threshold of 0 switches the rule off rather than making everything free', async () => {
  // The trap this guards: `subtotal >= 0` is true for every order, so a blanked
  // field would silently hand every delivery cost to every shop.
  await setConfig(CONFIG_KEYS.FREE_DELIVERY_THRESHOLD, '0');
  const order = await place({ quantity: 10 }); // ₹1000, comfortably "above"

  assert.equal(order.shopFundsDelivery, false);
  assert.equal(Number(order.deliveryFee), 25);
});

// ── Who ends up paying ─────────────────────────────────────────────────────

test('above the threshold the SHOP pays the rider, out of its payable', async () => {
  const placed = await place({ quantity: 2 }); // ₹200, free delivery
  const { order, job } = await deliver(placed.id);

  // Shop and address are the same point, so the rider earns the base ₹25.
  assert.equal(Number(job.riderEarning), 25);
  // ₹200 grand total, no commission, less the ₹25 the shop owes for the drop.
  assert.equal(Number(order.shopPayable), 175);
});

test('below the threshold the CUSTOMER’s fee funds the rider, and the shop keeps its goods money', async () => {
  const placed = await place({ quantity: 1 }); // ₹100 + ₹25 fee
  const { order } = await deliver(placed.id);

  // ⚠️ The fee is subtracted. It used to flow to the shop inside `grandTotal`
  // while the platform still paid the rider — the bug commission was masking.
  assert.equal(Number(order.grandTotal), 125);
  assert.equal(Number(order.shopPayable), 100);
});

test('the shop is charged what the drop really cost, not a flat guess', async () => {
  // A distant customer costs the shop more, which is the point of deducting the
  // frozen `riderEarning` rather than the flat fee.
  // ~3.3 km: comfortably past the free 2 km, comfortably inside the shop's 5 km
  // service radius, so the order is serviceable and the distance still prices.
  const far = await createAddress({
    customerId: customer.id, latitude: LAT + 0.03, longitude: LNG, isDefault: false
  });
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 2
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: far.id, paymentMethod: 'COD'
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));

  const { order, job } = await deliver(placed.body.order.id);

  assert.ok(Number(job.riderEarning) > 25, 'the distance did not price into the fee');
  assert.equal(
    Number(order.shopPayable),
    Number(order.grandTotal) - Number(job.riderEarning)
  );
});

// ── Frozen, like every other money decision here ───────────────────────────

test('moving the threshold afterwards cannot re-bill an order already placed', async () => {
  const placed = await place({ quantity: 2 }); // free delivery, ₹200
  assert.equal(placed.shopFundsDelivery, true);

  // Somebody raises the bar the next morning.
  await setConfig(CONFIG_KEYS.FREE_DELIVERY_THRESHOLD, '500');

  const { order } = await deliver(placed.id);
  // Still free to the customer, still funded by the shop. Re-deriving it at
  // delivery would have charged a customer who was promised free delivery.
  assert.equal(order.shopFundsDelivery, true);
  assert.equal(Number(order.deliveryFee), 0);
  assert.equal(Number(order.shopPayable), 175);
});

test('a membership has no rider, so nobody funds a delivery', async () => {
  const gym = await createIndustry({ name: 'Gym', fulfilmentType: 'NO_DELIVERY' });
  const gymShop = await prisma.user.create({
    data: {
      email: `gym-${Date.now()}@test.roadmate`, password: 'x', name: 'Gym',
      role: 'SHOP', isActive: true, isOpen: true, industryId: gym.id,
      latitude: LAT, longitude: LNG, serviceRadiusKm: 5, safetyStockBuffer: 100
    }
  });
  const membership = await createProduct({
    name: 'Annual membership', industryId: gym.id, ownerId: world.master.id
  });
  await stockShop({ shopId: gymShop.id, productId: membership.id, quantity: 10, sellingPrice: 5000 });

  await as(token).post('/api/customer/cart/items', {
    shopId: gymShop.id, productId: membership.id, quantity: 1
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: gymShop.id, paymentMethod: 'PREPAID'
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));

  const order = await prisma.consumerOrder.findUnique({ where: { id: placed.body.order.id } });
  // ₹5000 is far above the threshold, but there is no delivery to fund: no
  // rider, no address, no journey. Charging the gym for one would be inventing
  // a cost.
  assert.equal(order.shopFundsDelivery, false);
});
