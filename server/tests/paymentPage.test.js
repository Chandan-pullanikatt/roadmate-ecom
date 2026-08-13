// The hosted checkout page (2026-08-12).
//
// The app carries no WebView and no Razorpay SDK — both are native modules, and
// a native module crashes every installed dev client across three codebases — so
// paying means handing off to the phone's browser. A browser holds no session,
// which is the whole reason this page needs its own authorisation, and the whole
// reason it is worth testing separately from the endpoints around it.
//
// Four things pinned here:
//   · The ticket is the authorisation, it is bound to ONE order, and a ticket
//     from another audience is not a ticket.
//   · The page can pay and can do nothing else. In particular it cannot mark a
//     payment PAID — only the signed webhook does that.
//   · Every failure renders a page a customer can read, never JSON and never a
//     blank screen. They are holding a phone with money on the line.
//   · Without gateway credentials it says so, rather than opening a checkout
//     against a stub id that no gateway has ever heard of.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';
import { createProduct, stockShop, createCustomer, createAddress, createRider } from './helpers/factories.js';
import { signPaymentPageToken, PAYMENT_PAGE_AUDIENCE } from '../src/lib/paymentPageToken.js';

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
  // Serviceability needs a rider on shift in range, or placement is a 422 before
  // it ever reaches a payment (HANDOFF §6, Phase 3).
  await createRider({ lastLat: LAT, lastLng: LNG });
  customer = await createCustomer({ name: 'Anjali Menon' });
  token = customerTokenFor(customer);
  address = await createAddress({ customerId: customer.id, latitude: LAT, longitude: LNG });
  product = await createProduct({
    name: 'Toor Dal 1kg', industryId: world.industry.id, ownerId: world.master.id
  });
});

after(async () => {
  await disconnect();
});

const as = (t) => ({
  post: (path, body) => request(app).post(path).set('Authorization', `Bearer ${t}`).send(body),
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${t}`)
});

async function place({ paymentMethod = 'PREPAID' } = {}) {
  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(token).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 2
  });
  const res = await as(token).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: address.id, paymentMethod
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.order.id;
}

/**
 * Give the order a gateway order id directly.
 *
 * ⚠️ Load-bearing, not a shortcut. With credentials present the page creates one
 * if it is missing — which is a **real HTTP call to Razorpay**, and no test in
 * this suite may make a network call (that rule is why `.env.test` is
 * credential-free in the first place). Writing the column is how the live
 * rendering path gets exercised without one.
 */
const withGatewayOrder = (orderId, razorpayOrderId = 'order_TESTFAKE123') =>
  prisma.payment.update({ where: { consumerOrderId: orderId }, data: { razorpayOrderId } });

/**
 * The gateway credentials, for the tests that need `isLive()` true. `.env.test`
 * is deliberately credential-free — that absence is what stops the suite from
 * ever touching the client's real account — so a test that needs the live branch
 * sets fakes and puts them back.
 */
function withCredentials(fn) {
  const before = {
    id: process.env.RAZORPAY_KEY_ID,
    secret: process.env.RAZORPAY_KEY_SECRET
  };
  process.env.RAZORPAY_KEY_ID = 'rzp_test_FAKEFORTESTS';
  process.env.RAZORPAY_KEY_SECRET = 'fake_secret_for_tests';
  return (async () => {
    try {
      return await fn();
    } finally {
      if (before.id === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = before.id;
      if (before.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = before.secret;
    }
  })();
}

// --- the ticket ---------------------------------------------------------------

test('the endpoint hands back a payment URL carrying a ticket for that order', async () => {
  const orderId = await place();
  const res = await as(token).post(`/api/customer/orders/${orderId}/razorpay-order`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.paymentUrl, 'expected a paymentUrl');
  assert.match(res.body.paymentUrl, new RegExp(`/pay/${orderId}\\?t=`));

  // Every field this endpoint returned before is still returned — the addition
  // is additive, and a client driving checkout itself still has what it needs.
  assert.ok(res.body.razorpayOrderId);
  assert.equal(res.body.currency, 'INR');
  assert.equal(res.body.amount, '200.00');
});

test('a ticket opens its own order and no other', async () => {
  const mine = await place();

  const page = await request(app).get(`/pay/${mine}?t=${signPaymentPageToken(mine)}`);
  assert.notEqual(page.status, 403);

  // The same valid ticket, pointed at a different order id in the path.
  const other = await request(app).get(`/pay/${mine + 1}?t=${signPaymentPageToken(mine)}`);
  assert.equal(other.status, 403);
  assert.match(other.text, /expired/i);
});

test('no ticket, a junk ticket, and an expired ticket are all one page', async () => {
  const orderId = await place();
  const expired = jwt.sign({ orderId, typ: 'payment-page' }, process.env.JWT_SECRET, {
    audience: PAYMENT_PAGE_AUDIENCE,
    expiresIn: -10
  });

  for (const url of [`/pay/${orderId}`, `/pay/${orderId}?t=nonsense`, `/pay/${orderId}?t=${expired}`]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 403, url);
    assert.match(res.headers['content-type'], /html/);
  }
});

test('a customer session token is not a payment ticket', async () => {
  const orderId = await place();

  // The right secret, the wrong audience — which is the whole point of giving
  // this page an audience of its own.
  const res = await request(app).get(`/pay/${orderId}?t=${token}`);
  assert.equal(res.status, 403);
});

// --- what the page renders ----------------------------------------------------

test('the page renders the amount, the order number and the gateway order', async () => {
  const orderId = await place();
  await withGatewayOrder(orderId);
  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });

  await withCredentials(async () => {
    const page = await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /html/);
    assert.match(page.text, /checkout\.razorpay\.com/);
    assert.match(page.text, new RegExp(order.orderNumber));
    assert.match(page.text, /200\.00/);
    assert.match(page.text, /rzp_test_FAKEFORTESTS/);
    assert.match(page.text, /order_TESTFAKE123/);
  });
});

test('the page never carries the key secret', async () => {
  const orderId = await place();
  await withGatewayOrder(orderId);
  await withCredentials(async () => {
    const page = await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);
    assert.doesNotMatch(page.text, /fake_secret_for_tests/);
  });
});

test('without credentials the page says so instead of opening a doomed checkout', async () => {
  const orderId = await place();
  const page = await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);

  assert.equal(page.status, 503);
  assert.match(page.text, /not set up/i);
  assert.doesNotMatch(page.text, /checkout\.razorpay\.com/);
});

test('a COD order is told there is nothing to pay here', async () => {
  const orderId = await place({ paymentMethod: 'COD' });
  const page = await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);

  assert.equal(page.status, 200);
  assert.match(page.text, /cash.on.delivery/i);
  assert.doesNotMatch(page.text, /checkout\.razorpay\.com/);
});

test('an already-paid order says so calmly, and is not an error', async () => {
  const orderId = await place();
  await prisma.payment.update({
    where: { consumerOrderId: orderId },
    data: { status: 'PAID' }
  });

  const page = await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /already paid/i);
});

// --- what the page must NOT be able to do ------------------------------------

test('rendering the page pays nothing — only the webhook does that', async () => {
  const orderId = await place();
  await withGatewayOrder(orderId);
  await withCredentials(async () => {
    await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);
  });

  const payment = await prisma.payment.findUnique({ where: { consumerOrderId: orderId } });
  assert.equal(payment.status, 'PENDING');

  const order = await prisma.consumerOrder.findUnique({ where: { id: orderId } });
  assert.equal(order.status, 'PLACED', 'an unpaid order must never be routed');
});

test('the deep link points back at the order the ticket opened', async () => {
  const orderId = await place();
  await withGatewayOrder(orderId);
  await withCredentials(async () => {
    const page = await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);
    assert.match(page.text, new RegExp(`roadmate://order/${orderId}`));
  });
});

test('a name containing markup cannot break out of the page', async () => {
  const nasty = await createCustomer({ name: '</script><script>alert(1)</script>' });
  const nastyToken = customerTokenFor(nasty);
  const nastyAddress = await createAddress({ customerId: nasty.id, latitude: LAT, longitude: LNG });

  await stockShop({ shopId: world.shop.id, productId: product.id, quantity: 10, sellingPrice: 100 });
  await as(nastyToken).post('/api/customer/cart/items', {
    shopId: world.shop.id, productId: product.id, quantity: 1
  });
  const placed = await as(nastyToken).post('/api/customer/orders', {
    shopId: world.shop.id, addressId: nastyAddress.id, paymentMethod: 'PREPAID'
  });
  const orderId = placed.body.order.id;
  await withGatewayOrder(orderId);

  await withCredentials(async () => {
    const page = await request(app).get(`/pay/${orderId}?t=${signPaymentPageToken(orderId)}`);
    // The literal closing tag must not survive into the document, or the name
    // has ended the script block and everything after it is markup.
    assert.doesNotMatch(page.text, /<\/script><script>alert/);
  });
});
