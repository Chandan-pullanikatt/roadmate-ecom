// The contract the `(exec)` screens read.
//
// Nobody had ever driven the executive screens against a running API — they were
// written against the controllers by reading them, and shipped on the strength
// of the app bundling. Bundling proves the imports resolve; it proves nothing at
// all about whether `order.items[0].product.sku` is a field that exists.
//
// So this file is the executive half of the app, walked end to end against a
// real database, asserting the **exact** field names the screens dereference. It
// is not a controller test — `partnerController` and `orderController` are the
// seven dashboards' endpoints and have their own behaviour. It is a test that
// the app and the API still agree, and it is the thing that will fail if
// somebody reshapes a response later.
//
// Where a screen reads `a?.b ?? fallback`, the fallback is not tested: an
// optional field is allowed to be absent. Where a screen reads `a.b` outright,
// its absence is a crash on a partner's phone, and that is what is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';

const PASSWORD_HASH = bcrypt.hashSync('test1234', 4);

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

async function makeUser(role, extra = {}) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@test.roadmate`,
      password: PASSWORD_HASH,
      name: `${role} User`,
      businessName: `${role} Business`,
      role,
      isActive: true,
      ...extra
    }
  });
}

/**
 * One trade chain: a manufacturer sells to a distributor, and the distributor
 * supplies a shop. That is HANDOFF §1's B2B half, and it is the smallest world
 * in which "a distributor is on both sides" is actually true.
 */
async function seedTradeWorld() {
  const { industry } = await seedBaseline();
  const territory = { stateName: 'Telangana', districtName: 'Hyderabad', regionName: 'Banjara Hills' };

  const manufacturer = await makeUser('MANUFACTURER', { industryId: industry.id, ...territory });
  const distributor = await makeUser('DISTRIBUTOR', { industryId: industry.id, ...territory });
  const regional = await makeUser('REGIONAL', { industryId: industry.id, ...territory });
  const shop = await makeUser('SHOP', {
    industryId: industry.id,
    ...territory,
    creditLimit: 50000,
    outstandingDue: 12500
  });

  const product = await prisma.product.create({
    data: {
      name: 'TVS Chain Lube 2.0',
      sku: 'RM-44021',
      price: 38.25,
      stockLevel: 500,
      industryId: industry.id,
      ownerId: distributor.id
    }
  });

  // The distributor selling to the shop — the row a distributor sees under
  // "To fulfil", and the one with the status ladder on it.
  const order = await prisma.tradeOrder.create({
    data: {
      orderNumber: 'RM-8231',
      buyerId: shop.id,
      sellerId: distributor.id,
      industryId: industry.id,
      totalAmount: 7940,
      status: 'Pending',
      items: { create: [{ productId: product.id, quantity: 4, price: 38.25 }] }
    }
  });

  return { industry, manufacturer, distributor, regional, shop, product, order, territory };
}

test.after(disconnect);

// --- the order book (exec/orders.js) -----------------------------------------

test('the order list gives every field the orders screen renders', async () => {
  await resetDb();
  const { distributor, shop } = await seedTradeWorld();

  const res = await request(app).get('/api/orders').set(auth(distributor));
  assert.equal(res.status, 200);

  const [order] = res.body.orders;
  assert.ok(order, 'a distributor should see the order it is selling');

  // `OrderCard` title, meta, pill and amount, in that order.
  assert.equal(typeof order.orderNumber, 'string');
  assert.ok(order.createdAt, 'meta line renders a date');
  assert.ok(Array.isArray(order.items), 'meta line counts items');
  assert.equal(typeof order.status, 'string');
  assert.equal(typeof order.totalAmount, 'number', 'B2B money is a Float, formatAmount depends on it');

  // `counterpartyOf` / `isSeller` both dereference these without a guard.
  assert.equal(order.sellerId, distributor.id);
  assert.equal(order.buyerId, shop.id);
  assert.ok(order.buyer, 'counterpartyOf reads order.buyer');
  assert.ok(order.seller, 'counterpartyOf reads order.seller');
  assert.ok(order.buyer.businessName || order.buyer.name);
});

test('a distributor is on both sides, which is what the To fulfil / My purchases filter splits', async () => {
  await resetDb();
  const { distributor, manufacturer, industry } = await seedTradeWorld();

  const bought = await prisma.product.create({
    data: { name: 'Bulk lube', sku: 'RM-9', price: 20, stockLevel: 100, industryId: industry.id, ownerId: manufacturer.id }
  });
  await prisma.tradeOrder.create({
    data: {
      orderNumber: 'RM-9001',
      buyerId: distributor.id,
      sellerId: manufacturer.id,
      industryId: industry.id,
      totalAmount: 2000,
      status: 'Pending',
      items: { create: [{ productId: bought.id, quantity: 100, price: 20 }] }
    }
  });

  const res = await request(app).get('/api/orders').set(auth(distributor));
  const selling = res.body.orders.filter((o) => o.sellerId === distributor.id);
  const buying = res.body.orders.filter((o) => o.sellerId !== distributor.id);

  assert.equal(selling.length, 1);
  assert.equal(buying.length, 1);
});

// --- order detail (exec/order/[orderId].js) ----------------------------------

test('order detail gets the item, party and SKU fields it renders', async () => {
  await resetDb();
  const { distributor } = await seedTradeWorld();

  const res = await request(app).get('/api/orders').set(auth(distributor));
  const [order] = res.body.orders;

  const [item] = order.items;
  assert.equal(typeof item.quantity, 'number');
  assert.equal(typeof item.price, 'number');
  // The screen renders `<Sku>{item.product?.sku}</Sku>` and
  // `item.product?.name` — optional-chained, but they should be there.
  assert.ok(item.product, 'the detail screen renders item.product');
  assert.equal(item.product.sku, 'RM-44021');
  assert.equal(item.product.name, 'TVS Chain Lube 2.0');

  // The "Parties" grouped card.
  assert.ok(order.buyer.businessName || order.buyer.name);
  assert.ok(order.seller.businessName || order.seller.name);
  assert.ok(order.industry?.name, 'Parties card renders order.industry.name');
});

test('the status ladder walks Pending → Approved → Dispatched → Delivered', async () => {
  await resetDb();
  const { distributor, order } = await seedTradeWorld();

  for (const status of ['Approved', 'Dispatched', 'Delivered']) {
    const res = await request(app)
      .put(`/api/orders/${order.id}/status`)
      .set(auth(distributor))
      .send({ status });
    assert.equal(res.status, 200, `failed moving to ${status}: ${res.body.message}`);
  }

  const final = await prisma.tradeOrder.findUnique({ where: { id: order.id } });
  assert.equal(final.status, 'Delivered');
});

test('⚠️ each rung decrements the seller stock — which is why the UI offers exactly one', async () => {
  await resetDb();
  const { distributor, order, product } = await seedTradeWorld();

  const start = (await prisma.product.findUnique({ where: { id: product.id } })).stockLevel;

  await request(app).put(`/api/orders/${order.id}/status`).set(auth(distributor)).send({ status: 'Approved' });
  const afterOne = (await prisma.product.findUnique({ where: { id: product.id } })).stockLevel;
  assert.equal(afterOne, start - 4);

  // Calling it again takes the stock down a second time. This is the documented
  // hazard (PLAN §3), asserted rather than described so that if the endpoint is
  // ever hardened with a conditional updateMany, this test fails and tells the
  // next person the UI guard can be relaxed.
  await request(app).put(`/api/orders/${order.id}/status`).set(auth(distributor)).send({ status: 'Approved' });
  const afterTwo = (await prisma.product.findUnique({ where: { id: product.id } })).stockLevel;
  assert.equal(afterTwo, start - 8, 'endpoint is still not idempotent — keep the one-rung UI');
});

// --- the network screen (exec/network.js) ------------------------------------

test('a regional partner sees its pending queue with the fields the card renders', async () => {
  await resetDb();
  const { regional, industry, territory } = await seedTradeWorld();

  const pending = await makeUser('SHOP', {
    industryId: industry.id,
    ...territory,
    isActive: false,
    phone: '9876511111'
  });

  const res = await request(app).get('/api/partners/pending').set(auth(regional));
  assert.equal(res.status, 200);

  const row = res.body.approvals.find((p) => p.id === pending.id);
  assert.ok(row, 'a regional partner should see an inactive shop in its own region');
  assert.ok(row.businessName || row.name, 'PendingCard title');
  assert.equal(typeof row.role, 'string', 'roleLabel reads role');
  // `roleLabel` also reads `executiveType`, and the contact block reads these.
  assert.ok('executiveType' in row);
  assert.ok('phone' in row && 'email' in row);
  assert.ok('regionName' in row && 'districtName' in row);
});

test('approve activates, and reject really does delete the account', async () => {
  await resetDb();
  const { regional, industry, territory } = await seedTradeWorld();

  const a = await makeUser('SHOP', { industryId: industry.id, ...territory, isActive: false });
  const b = await makeUser('SHOP', { industryId: industry.id, ...territory, isActive: false });

  assert.equal((await request(app).post(`/api/partners/${a.id}/approve`).set(auth(regional))).status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: a.id } })).isActive, true);

  assert.equal((await request(app).post(`/api/partners/${b.id}/reject`).set(auth(regional))).status, 200);
  // The confirmation on the screen says "this deletes their account". It does.
  assert.equal(await prisma.user.findUnique({ where: { id: b.id } }), null);
});

test('a distributor sees its shops with the credit figures its card shows', async () => {
  await resetDb();
  const { distributor, shop } = await seedTradeWorld();

  const res = await request(app).get('/api/partners/active').set(auth(distributor));
  assert.equal(res.status, 200);

  const row = res.body.partners.find((p) => p.id === shop.id);
  assert.ok(row, 'a distributor should see the shops in its district');
  assert.equal(typeof row.creditLimit, 'number');
  assert.equal(typeof row.outstandingDue, 'number');
});

test('a manufacturer has no network, which is why the tab is hidden and not empty', async () => {
  await resetDb();
  const { manufacturer } = await seedTradeWorld();

  const pending = await request(app).get('/api/partners/pending').set(auth(manufacturer));
  const active = await request(app).get('/api/partners/active').set(auth(manufacturer));

  // Both fall through their role ladders to the fail-safe clauses. `roles.js`
  // turns that into `tabs.network: false`.
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.body.approvals, []);
  assert.equal(active.status, 200);
  assert.deepEqual(active.body.partners, []);
});

// --- the home screen's stat tiles (exec/index.js via roles.js) ---------------

test('each role gets exactly the overview keys its stat tiles read', async () => {
  await resetDb();
  const { manufacturer, distributor, regional } = await seedTradeWorld();

  // Mirrors `apps/business/src/roles.js`. If a key is renamed server-side, the
  // tile renders `undefined` and nothing else notices — so it is pinned here.
  const EXPECTED = {
    MANUFACTURER: ['totalSales', 'pendingOrders', 'completedOrders', 'activeDealers', 'catalogProducts'],
    DISTRIBUTOR: ['totalPurchased', 'pendingShipments', 'mappedShops', 'warehouseProducts'],
    REGIONAL: ['regionalRevenue', 'myShare', 'registeredShops', 'activeRiders']
  };

  for (const user of [manufacturer, distributor, regional]) {
    const res = await request(app).get('/api/dashboard/overview').set(auth(user));
    assert.equal(res.status, 200, `${user.role}: ${res.body.message}`);
    for (const key of EXPECTED[user.role]) {
      assert.ok(key in res.body.stats, `${user.role} overview is missing ${key}`);
      assert.equal(typeof res.body.stats[key], 'number', `${user.role}.${key} should be a number`);
    }
  }
});

test('the products tab returns a catalogue for the roles that have one', async () => {
  await resetDb();
  const { distributor } = await seedTradeWorld();

  const res = await request(app).get('/api/products').set(auth(distributor));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.products));
});

test('a regional partner has payouts, which is the one money figure it is shown', async () => {
  await resetDb();
  const { regional, distributor, order } = await seedTradeWorld();

  // Delivering is what writes the splits.
  await request(app).put(`/api/orders/${order.id}/status`).set(auth(distributor)).send({ status: 'Delivered' });

  const res = await request(app).get('/api/payouts').set(auth(regional));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.payouts));

  // Phase 0 renamed `Payout.orderId` to `tradeOrderId` but kept serialising the
  // key as `order` so the dashboards kept working. The profile screen reads it.
  for (const payout of res.body.payouts) {
    assert.ok('amount' in payout);
    assert.ok('status' in payout);
  }
});

// --- the rule that must never be broken --------------------------------------

test('no executive endpoint leaks the commission percentage', async () => {
  await resetDb();
  const { regional, distributor, manufacturer, order } = await seedTradeWorld();

  await request(app).put(`/api/orders/${order.id}/status`).set(auth(distributor)).send({ status: 'Delivered' });

  // PLAN §7.1: the 15 is undocumented and unconfirmed, and it is on no screen.
  // The app not rendering it is one half; the API not handing it over is the
  // half that survives someone adding a generic "show everything" debug panel.
  for (const user of [regional, distributor, manufacturer]) {
    for (const path of ['/api/dashboard/overview', '/api/orders', '/api/payouts']) {
      const res = await request(app).get(path).set(auth(user));
      const body = JSON.stringify(res.body);
      assert.ok(
        !/commission_?[Pp]ercent|commissionRate/.test(body),
        `${user.role} ${path} exposes a commission rate`
      );
    }
  }
});
