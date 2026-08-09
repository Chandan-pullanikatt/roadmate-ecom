// The contract the Customer app's screens read (Phase 4).
//
// The third of its family, after `tests/execApp.test.js` and
// `tests/riderApp.test.js`, and it exists for exactly the same reason: bundling
// an Expo app proves the imports resolve and proves *nothing* about whether
// `item.availableQty` is a field the API sends. The customer screens dereference
// a shelf row, a cart line, a bill panel and an order ladder field by field, and
// every one of those names is pinned here against a real database.
//
// It is not a controller test — `tests/catalogCart.test.js`,
// `tests/orderPlacement.test.js`, `tests/routing.test.js` and
// `tests/fulfilmentTypes.test.js` own the pipeline's behaviour. This file
// asserts that the app and the API still agree.
//
// Where a screen reads `a?.b ?? fallback`, the fallback is not tested: an
// optional field may be absent. Where a screen reads `a.b` outright, its absence
// is a blank line in somebody's basket or a crash on a live order, and that is
// what is pinned.
//
// Five things beyond field names are pinned deliberately, because each is a
// screen *decision* rather than a shape:
//
//   • **`serviceable: false` carries a `reason`.** Home says two different
//     sentences for `NO_SHOP` and `NO_RIDER`, and "not available in your area"
//     for what is really "come back in an hour" is how somebody deletes the app.
//   • **Carts are plural.** The Cart tab renders `carts[]`, one per shop,
//     because adding from a second shop opens a second cart.
//   • **`order.shop` is null until a shop accepts.** The orders list and the
//     tracking screen both key off that, since an order is not bound to a shop
//     at placement (HANDOFF §3).
//   • **`attempts` is what "we kept trying" is drawn from**, so a rerouted order
//     has more than one and the app can say so without naming a shop that
//     declined.
//   • **Money is a fixed-2 string, everywhere.** `formatINR` formats a string by
//     manipulating the string; a number arriving here would be silently
//     reformatted into a plausible, wrong figure.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createIndustry,
  createShop,
  createRider,
  createProduct,
  stockShop,
  createCustomer,
  createAddress
} from './helpers/factories.js';

const LAT = 12.9716;
const LNG = 77.5946;

/** Every money field the app formats with `formatINR`, which never parses. */
const isMoneyString = (v) => typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v);

let world;
let master;
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

  customer = await createCustomer();
  token = customerTokenFor(customer);
  address = await createAddress({ customerId: customer.id, latitude: LAT, longitude: LNG });

  // Serviceability is *shop in range* AND *rider on shift* — without this every
  // catalog call in the file would correctly answer NO_RIDER.
  await createRider({ lastLat: LAT, lastLng: LNG, isOnShift: true });
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

/** A shop in `world.industry` with one product on the shelf. */
async function stockedShop({ sellingPrice = 250, quantity = 10, industryId = null } = {}) {
  const shop = await createShop({
    industryId: industryId ?? world.industry.id,
    latitude: LAT,
    longitude: LNG
  });
  const product = await createProduct({ industryId: industryId ?? world.industry.id, ownerId: master.id });
  const inventory = await stockShop({ shopId: shop.id, productId: product.id, quantity, sellingPrice });
  return { shop, product, inventory };
}

// --- the home screen ---------------------------------------------------------

test('the industry switcher gets id, name and fulfilmentType from /api/industries', async () => {
  await createIndustry({ name: 'Gym', fulfilmentType: 'NO_DELIVERY' });

  // Public on purpose: the chips are populated before a customer signs in.
  const res = await request(app).get('/api/industries');
  assert.equal(res.status, 200);

  const industry = res.body.industries.find((i) => i.id === world.industry.id);
  assert.ok(industry, 'the seeded industry is listed');
  assert.equal(typeof industry.name, 'string');
  assert.equal(typeof industry.fulfilmentType, 'string');
  // `place.js` filters on this before choosing a default chip.
  assert.equal(typeof industry.isActive, 'boolean');
});

test('serviceable shops carry the three fields the home list renders', async () => {
  const { shop } = await stockedShop();

  const res = await as(token).get(
    `/api/customer/serviceable?lat=${LAT}&lng=${LNG}&industryId=${world.industry.id}`
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.serviceable, true);

  const row = res.body.shops.find((s) => s.id === shop.id);
  assert.ok(row, 'the stocked shop is serviceable');
  assert.equal(typeof row.name, 'string');
  assert.equal(typeof row.distanceKm, 'number');
});

test('an unserviceable answer says WHICH no it is', async () => {
  // A rider standing somewhere no shop is. Coverage is fine; there is simply
  // nothing to buy — which is the "not here yet" sentence, not the "come back
  // shortly" one.
  await createRider({ lastLat: 13.5, lastLng: 78.5, isOnShift: true });
  const far = await as(token).get(`/api/customer/serviceable?lat=13.5&lng=78.5&industryId=${world.industry.id}`);
  assert.equal(far.body.serviceable, false);
  assert.equal(far.body.reason, 'NO_SHOP');

  // A shop in range with nobody to collect from it. This is the branch the home
  // screen phrases as "come back shortly" rather than "not available here".
  await stockedShop();
  await prisma.user.updateMany({ where: { executiveType: 'DELIVERY' }, data: { isOnShift: false } });

  const noRider = await as(token).get(
    `/api/customer/serviceable?lat=${LAT}&lng=${LNG}&industryId=${world.industry.id}`
  );
  assert.equal(noRider.body.serviceable, false);
  assert.equal(noRider.body.reason, 'NO_RIDER');
});

// --- the two halves of the hybrid browse -------------------------------------

test('a shelf row carries everything the shop screen and its options sheet read', async () => {
  const { shop, product, inventory } = await stockedShop({ sellingPrice: 199.5 });
  await prisma.productAddOn.create({
    data: { productId: product.id, groupName: 'Size', label: 'Large', price: 20, isRequired: true, maxSelect: 1 }
  });

  const res = await as(token).get(`/api/customer/shops/${shop.id}/products`);
  assert.equal(res.status, 200);
  // The header renders the shop's name and its open state.
  assert.equal(typeof res.body.shop.name, 'string');
  assert.equal(typeof res.body.shop.isOpen, 'boolean');

  const item = res.body.items.find((i) => i.inventoryId === inventory.id);
  assert.ok(item, 'the stocked row is on the shelf');
  assert.equal(item.productId, product.id);
  assert.equal(typeof item.productName, 'string');
  assert.ok(isMoneyString(item.price), `price should be a fixed-2 string, got ${item.price}`);
  // The stepper's ceiling. NOT the shop's real count — `sellableQty` already
  // took the safety buffer and anything reserved out of it.
  assert.equal(typeof item.availableQty, 'number');
  assert.ok(item.availableQty <= 10);
  // The promise the client made (HANDOFF §7.6). The row renders "Sold out" from
  // this boolean rather than from arithmetic on the count, so that the count can
  // stop being published without touching a screen.
  assert.equal(item.inStock, true);
  assert.equal(typeof res.body.inStockCount, 'number');

  const addOn = item.addOns[0];
  assert.ok(addOn, 'add-ons ride along with the shelf row');
  assert.equal(typeof addOn.id, 'number');
  assert.equal(typeof addOn.label, 'string');
  assert.equal(typeof addOn.groupName, 'string');
  // The sheet groups by `groupName`, disables Add until a required group is
  // answered, and caps a group at `maxSelect`.
  assert.equal(addOn.isRequired, true);
  assert.equal(addOn.maxSelect, 1);
  assert.ok(isMoneyString(addOn.price));
});

test('a sold-out row is still on the shelf, marked, and last', async () => {
  const { shop, product, inventory } = await stockedShop();
  const gone = await createProduct({ industryId: world.industry.id, ownerId: master.id });
  const goneRow = await stockShop({ shopId: shop.id, productId: gone.id, quantity: 3, reserved: 3 });

  const res = await as(token).get(`/api/customer/shops/${shop.id}/products`);
  const ids = res.body.items.map((i) => i.inventoryId);

  // Present, not absent: absence reads as "this shop does not stock it", which
  // is a different claim from "they are out of it".
  assert.ok(ids.includes(goneRow.id));
  assert.equal(ids.indexOf(goneRow.id), ids.length - 1, 'sold out sorts last');
  assert.equal(res.body.items.find((i) => i.inventoryId === goneRow.id).inStock, false);
  assert.equal(res.body.items.find((i) => i.inventoryId === inventory.id).inStock, true);
  assert.equal(res.body.inStockCount, 1);
  assert.equal(res.body.count, 2);
  assert.ok(product);
});

test('a product nobody can sell today is listed as sold out, behind the ones that can', async () => {
  const stocked = await stockedShop({ sellingPrice: 400 });
  const out = await stockedShop({ sellingPrice: 100 });
  await prisma.shopInventory.update({ where: { id: out.inventory.id }, data: { reserved: 10 } });

  const res = await as(token).get(`/api/customer/products?lat=${LAT}&lng=${LNG}`);
  const byProduct = new Map(res.body.products.map((p) => [p.id, p]));

  // The cheap one is sold out, so despite being cheaper it does not lead the
  // list — a buyable offer always outranks one that is not.
  assert.equal(byProduct.get(out.product.id).inStock, false);
  assert.equal(byProduct.get(stocked.product.id).inStock, true);
  assert.equal(res.body.products[0].id, stocked.product.id);
  assert.equal(byProduct.get(out.product.id).offers[0].inStock, false);
});

test('browse-by-product groups offers per shop, cheapest first', async () => {
  const cheap = await stockedShop({ sellingPrice: 100 });
  const dear = await stockedShop({ sellingPrice: 300 });
  // The same product on two shelves is what makes this the *product* view.
  await stockShop({ shopId: dear.shop.id, productId: cheap.product.id, quantity: 5, sellingPrice: 120 });

  const res = await as(token).get(
    `/api/customer/products?lat=${LAT}&lng=${LNG}&industryId=${world.industry.id}`
  );
  assert.equal(res.status, 200);

  const product = res.body.products.find((p) => p.id === cheap.product.id);
  assert.ok(product);
  assert.equal(typeof product.name, 'string');
  assert.ok(product.offers.length >= 2);

  const [best, next] = product.offers;
  // The search screen renders `best.price`, `best.shop.name`, `best.shop.distanceKm`
  // and never re-sorts — a second opinion on the same question.
  assert.ok(isMoneyString(best.price));
  assert.equal(typeof best.shop.name, 'string');
  assert.equal(typeof best.shop.distanceKm, 'number');
  assert.ok(Number(best.price) <= Number(next.price), 'offers arrive cheapest first');
});

// --- the cart ----------------------------------------------------------------

test('carts are plural, one per shop, and each line carries its own money', async () => {
  const a = await stockedShop({ sellingPrice: 100 });
  const b = await stockedShop({ sellingPrice: 250 });

  await as(token).post('/api/customer/cart/items', { shopId: a.shop.id, productId: a.product.id, quantity: 2 });
  await as(token).post('/api/customer/cart/items', { shopId: b.shop.id, productId: b.product.id, quantity: 1 });

  const res = await as(token).get('/api/customer/cart');
  assert.equal(res.status, 200);
  // Two shops, two carts. Adding from the second did not move the first.
  assert.equal(res.body.carts.length, 2);

  const cart = res.body.carts.find((c) => c.shopId === a.shop.id);
  assert.equal(typeof cart.id, 'number');
  assert.equal(typeof cart.shop.name, 'string');
  assert.equal(cart.itemCount, 2);
  assert.ok(isMoneyString(cart.subtotal));
  // The Cart tab blocks checkout on this rather than letting placement refuse.
  assert.equal(cart.hasUnavailableItems, false);

  const line = cart.items[0];
  assert.equal(typeof line.id, 'number');
  assert.equal(typeof line.productName, 'string');
  assert.equal(line.quantity, 2);
  assert.ok(isMoneyString(line.unitPrice));
  assert.ok(isMoneyString(line.lineTotal));
  assert.equal(typeof line.availableQty, 'number');
  assert.equal(line.isAvailable, true);
  assert.ok(Array.isArray(line.addOns));
});

test('over-adding answers 409 with availableQty, which is what the sheet shows', async () => {
  const { shop, product } = await stockedShop({ quantity: 3 });

  const res = await as(token).post('/api/customer/cart/items', {
    shopId: shop.id,
    productId: product.id,
    quantity: 99
  });

  // Not an error to retry: the shelf is the answer, and the number in it is the
  // one the customer is told.
  assert.equal(res.status, 409);
  assert.equal(typeof res.body.availableQty, 'number');
});

test('quantity 0 removes the line — the stepper has no separate delete', async () => {
  const { shop, product } = await stockedShop();
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 2 });

  const before_ = await as(token).get('/api/customer/cart');
  const line = before_.body.carts[0].items[0];

  const res = await as(token).patch(`/api/customer/cart/items/${line.id}`, { quantity: 0 });
  assert.equal(res.status, 200);
  assert.equal(res.body.cart.items.length, 0);
});

// --- placement and the bill --------------------------------------------------

test('a placed order comes back with the whole bill panel as fixed-2 strings', async () => {
  const { shop, product } = await stockedShop({ sellingPrice: 250 });
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 2 });

  const res = await as(token).post('/api/customer/orders', {
    shopId: shop.id,
    addressId: address.id,
    paymentMethod: 'COD',
    instructions: 'Ring the bell'
  });
  assert.equal(res.status, 201);

  const order = res.body.order;
  assert.equal(typeof order.id, 'number');
  assert.equal(typeof order.orderNumber, 'string');
  // COD is confirmed at placement, so the order is already being offered — the
  // first thing the tracking screen renders is "finding a shop", not
  // "confirming". A prepaid order is the one that waits at PLACED.
  assert.equal(order.status, 'ROUTING');
  for (const field of ['subtotal', 'taxAmount', 'deliveryFee', 'discountAmount', 'tipAmount', 'grandTotal']) {
    assert.ok(isMoneyString(order[field]), `${field} should be a fixed-2 string, got ${order[field]}`);
  }
  assert.equal(order.paymentMethod, 'COD');
  // COD is confirmed on placement; only a prepaid order is still waiting.
  assert.equal(order.requiresPayment, false);
  assert.equal(order.instructions, 'Ring the bell');

  // **Not bound to a shop.** The tracking screen renders "finding you a shop"
  // from this being null, and the orders list omits the shop name.
  assert.equal(order.shop, null);
  // The shop whose shelf holds the reservation is named separately, and is not
  // the same claim.
  assert.equal(res.body.order.firstCandidateShop.id, shop.id);

  const item = order.items[0];
  assert.equal(item.productName, product.name);
  assert.equal(item.quantity, 2);
  assert.ok(isMoneyString(item.unitPrice));
  assert.ok(isMoneyString(item.lineTotal));
});

test('the tracking screen reads shop, address, attempts and a live status', async () => {
  const { shop, product } = await stockedShop();
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 1 });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: shop.id,
    addressId: address.id,
    paymentMethod: 'COD'
  });

  const shopToken = tokenFor(shop);
  await request(app)
    .post(`/api/shop/offers/${placed.body.order.id}/accept`)
    .set('Authorization', `Bearer ${shopToken}`)
    .send({});

  const res = await as(token).get(`/api/customer/orders/${placed.body.order.id}`);
  assert.equal(res.status, 200);

  const order = res.body.order;
  // Now bound. The screen switches from "finding a shop" to naming one.
  assert.equal(order.shop.id, shop.id);
  assert.equal(typeof order.shop.name, 'string');
  assert.equal(order.status, 'ACCEPTED');
  // The ladder in `src/order.js` is drawn against exactly these values.
  assert.ok(['PLACED', 'ROUTING', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED', 'DELIVERED'].includes(order.status));
  assert.equal(order.address.id, address.id);
  assert.equal(typeof order.address.label, 'string');
  // "We kept trying" is drawn from this, and from nothing else.
  assert.ok(Array.isArray(order.attempts));
  assert.equal(typeof order.attempts[0].sequence, 'number');
});

test('a rerouted order shows more than one attempt, and never names who declined', async () => {
  const first = await stockedShop();
  // The next candidate has to stock the *same* product, or `advanceOrder`'s
  // `requireStock` correctly finds nobody to move the order to.
  const second = await stockedShop();
  await stockShop({ shopId: second.shop.id, productId: first.product.id, quantity: 10, sellingPrice: 250 });
  await as(token).post('/api/customer/cart/items', {
    shopId: first.shop.id,
    productId: first.product.id,
    quantity: 1
  });
  const placed = await as(token).post('/api/customer/orders', {
    shopId: first.shop.id,
    addressId: address.id,
    paymentMethod: 'COD'
  });

  // The shop says no; `advanceOrder` moves it to the next candidate.
  await request(app)
    .post(`/api/shop/offers/${placed.body.order.id}/reject`)
    .set('Authorization', `Bearer ${tokenFor(first.shop)}`)
    .send({});

  const res = await as(token).get(`/api/customer/orders/${placed.body.order.id}`);
  const order = res.body.order;

  assert.ok(order.attempts.length >= 2, 'the reroute left a second attempt row');
  // Still unbound — a second shop has been *offered* the order, not given it.
  assert.equal(order.shop, null);
  assert.ok(second.shop.id > 0);
});

test('placement refuses with a reason the checkout screen has a sentence for', async () => {
  const { shop, product } = await stockedShop();
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 1 });

  // Everybody off shift: shops are in range, nobody can collect.
  await prisma.user.updateMany({ where: { executiveType: 'DELIVERY' }, data: { isOnShift: false } });

  const res = await as(token).post('/api/customer/orders', {
    shopId: shop.id,
    addressId: address.id,
    paymentMethod: 'COD'
  });

  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'NO_RIDER');
});

// --- the two industries that are a different shape ---------------------------

test('a membership refuses cash, with the reason the checkout screen reads', async () => {
  const gym = await createIndustry({ name: 'Gym', fulfilmentType: 'NO_DELIVERY' });
  const { shop, product } = await stockedShop({ industryId: gym.id });
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 1 });

  const res = await as(token).post('/api/customer/orders', {
    shopId: shop.id,
    paymentMethod: 'COD'
  });

  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'PREPAID_REQUIRED');
});

test('a paid membership becomes a voucher, which is the whole screen', async () => {
  const gym = await createIndustry({ name: 'Gym', fulfilmentType: 'NO_DELIVERY' });
  const { shop, product } = await stockedShop({ industryId: gym.id });
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 1 });

  const placed = await as(token).post('/api/customer/orders', {
    shopId: shop.id,
    paymentMethod: 'PREPAID'
  });
  assert.equal(placed.status, 201);
  // No address at all — which is what `isVoucherOrder` in the app keys off
  // before a voucher exists to key off instead.
  assert.equal(placed.body.order.address, undefined);
  assert.equal(placed.body.order.requiresPayment, true);

  const orderId = placed.body.order.id;
  const rp = await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`);
  const payload = {
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_TEST_CONSUMER', order_id: rp.body.razorpayOrderId } } }
  };
  const body = JSON.stringify(payload);
  const sig = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  await request(app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', sig)
    .send(body);

  const res = await as(token).get(`/api/customer/orders/${orderId}`);
  const voucher = res.body.order.vouchers[0];
  assert.ok(voucher, 'the sale produced a voucher');
  // The screen renders the code, the expiry and whether it has been used. No QR
  // image is drawn: the shop's app redeems by looking the code up, and has no
  // scanner.
  assert.equal(typeof voucher.code, 'string');
  assert.ok(voucher.validTo);
  assert.equal(voucher.isRedeemed, false);
  // Issuing the voucher *is* the fulfilment, so the sale is final.
  assert.equal(res.body.order.status, 'DELIVERED');
  assert.ok(product.id > 0);
});

test('a pharmacy order reports the gate it is waiting on', async () => {
  const pharmacy = await createIndustry({ name: 'Pharmacy', fulfilmentType: 'VERIFY_AND_DELIVER' });
  const { shop, product } = await stockedShop({ industryId: pharmacy.id });
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 1 });

  const placed = await as(token).post('/api/customer/orders', {
    shopId: shop.id,
    addressId: address.id,
    paymentMethod: 'COD'
  });
  assert.equal(placed.status, 201);

  // Before anything is uploaded the screen has to know an upload is what this
  // order is waiting for — that is `fulfilmentType` plus an empty
  // `prescriptions`, and it is what puts the camera button on the screen
  // (`blockedReason().needsUpload`).
  const waiting = await as(token).get(`/api/customer/orders/${placed.body.order.id}`);
  assert.equal(waiting.body.order.fulfilmentType, 'VERIFY_AND_DELIVER');
  assert.deepEqual(waiting.body.order.prescriptions, []);

  // The endpoint takes a URL, which is why it did not change when file storage
  // landed (PLAN §6). The app uploads to Cloudinary first and posts the result.
  const upload = await as(token).post(`/api/customer/orders/${placed.body.order.id}/prescription`, {
    imageUrl: 'https://example.test/rx.jpg'
  });
  assert.equal(upload.status, 201);

  const res = await as(token).get(`/api/customer/orders/${placed.body.order.id}`);
  const order = res.body.order;
  // `blockedReason()` in the app reads exactly these two fields to say "a
  // pharmacist is checking your prescription" rather than leaving the order
  // looking stuck.
  assert.equal(order.status, 'PLACED');
  assert.equal(typeof order.prescriptions[0].status, 'string');
  assert.notEqual(order.prescriptions[0].status, 'APPROVED');
});

// --- the address book --------------------------------------------------------

test('an address round-trips with the coordinates that route it', async () => {
  const res = await as(token).post('/api/customer/addresses', {
    label: 'Work',
    line1: '4 Residency Road',
    city: 'Bengaluru',
    pincode: '560025',
    latitude: LAT,
    longitude: LNG
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.address.label, 'Work');
  // The pin is the address. The rider navigates by these two numbers, never by
  // the typed street.
  assert.equal(typeof res.body.address.latitude, 'number');
  assert.equal(typeof res.body.address.longitude, 'number');

  // No coordinates, no address — the form will not let one be saved either.
  const bad = await as(token).post('/api/customer/addresses', { line1: 'Somewhere' });
  assert.equal(bad.status, 400);
});

test('an address an order used cannot be deleted, and says so with a 409', async () => {
  const { shop, product } = await stockedShop();
  await as(token).post('/api/customer/cart/items', { shopId: shop.id, productId: product.id, quantity: 1 });
  await as(token).post('/api/customer/orders', {
    shopId: shop.id,
    addressId: address.id,
    paymentMethod: 'COD'
  });

  const res = await as(token).del(`/api/customer/addresses/${address.id}`);
  assert.equal(res.status, 409);
});

// --- the session -------------------------------------------------------------

test('the two audiences stay apart: a staff token is not a customer', async () => {
  // The whole reason `protectCustomer` is a sibling of `protect` rather than a
  // branch of it. The Customer app holds one kind of token and could never be
  // handed the other, but the guard is what makes that a fact rather than a
  // convention.
  const staff = await request(app)
    .get('/api/customer/me')
    .set('Authorization', `Bearer ${tokenFor(master)}`);
  assert.equal(staff.status, 401);

  const mine = await as(token).get('/api/customer/me');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.customer.phone, customer.phone);
});
