// HANDOFF §7bis.2 — the B2B money that was hardcoded.
//
// Two things lived as constants in `orderController.js`: the commission pool
// (`totalAmount * 0.15`) and the five tier shares it is split into
// (10/15/20/25/30). Every other tunable number in the platform goes through
// `PlatformConfig`; these did not, so the B2B side could only be repriced by a
// deploy. Moving them changed no figure — the tests below assert the *old*
// numbers still come out by default — only who is allowed to change them.
//
// This file also pins the third thing that moved: the District dashboard's
// subscription fees, and the deletion of the rider subscription row. Riders are
// independent delivery partners the platform pays per order; billing them a
// ₹2,000/month subscription was revenue that was never going to be invoiced.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import { setConfig, CONFIG_KEYS } from '../src/lib/platformConfig.js';

const PASSWORD_HASH = bcrypt.hashSync('test1234', 4);
const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const TERRITORY = { stateName: 'Telangana', districtName: 'Hyderabad', regionName: 'Banjara Hills' };

const makeUser = (role, extra = {}) =>
  prisma.user.create({
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

/**
 * The onboarding hierarchy `updateOrderStatus` walks to find who gets paid:
 * master → state → industry-state → district → regional → shop.
 */
async function seedHierarchy() {
  const { industry } = await seedBaseline();
  const scope = { industryId: industry.id, ...TERRITORY };

  const master = await prisma.user.findFirst({ where: { role: 'MASTER' } });
  const state = await makeUser('STATE', scope);
  const indState = await makeUser('IND_STATE', { ...scope, parentId: state.id });
  const district = await makeUser('DISTRICT', { ...scope, parentId: indState.id });
  const regional = await makeUser('REGIONAL', { ...scope, parentId: district.id });
  const distributor = await makeUser('DISTRIBUTOR', scope);
  const shop = await makeUser('SHOP', { ...scope, parentId: regional.id });

  const product = await prisma.product.create({
    data: {
      name: 'Chain Lube', sku: 'RM-1', price: 100, stockLevel: 500,
      industryId: industry.id, ownerId: distributor.id
    }
  });

  const order = await prisma.tradeOrder.create({
    data: {
      orderNumber: `RM-${Math.random().toString(36).slice(2, 8)}`,
      buyerId: shop.id,
      sellerId: distributor.id,
      industryId: industry.id,
      totalAmount: 10000,
      status: 'Pending',
      items: { create: [{ productId: product.id, quantity: 1, price: 100 }] }
    }
  });

  return { industry, master, state, indState, district, regional, distributor, shop, order };
}

const deliver = (order, seller) =>
  request(app).put(`/api/orders/${order.id}/status`).set(auth(seller)).send({ status: 'Delivered' });

const payoutFor = (orderId, userId) =>
  prisma.payout.findFirst({ where: { tradeOrderId: orderId, recipientId: userId } });

test.after(disconnect);

// --- the commission pool and the five shares ---------------------------------

test('the default split is exactly what the hardcoded numbers produced', async () => {
  await resetDb();
  const world = await seedHierarchy();

  const res = await deliver(world.order, world.distributor);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // 15% of ₹10,000 = ₹1,500, split 10/15/20/25/30.
  const expected = [
    [world.state, 150],
    [world.indState, 225],
    [world.district, 300],
    [world.regional, 375],
    [world.master, 450]
  ];
  for (const [partner, amount] of expected) {
    const payout = await payoutFor(world.order.id, partner.id);
    assert.ok(payout, `${partner.role} should have been paid`);
    assert.equal(payout.amount, amount, `${partner.role} share`);
  }
});

test('the pool is config, so a new rate reprices the next delivery', async () => {
  await resetDb();
  const world = await seedHierarchy();
  await setConfig(CONFIG_KEYS.B2B_COMMISSION_PERCENT, 20);

  await deliver(world.order, world.distributor);

  // 20% of ₹10,000 = ₹2,000; the master's 30% of that is ₹600.
  assert.equal((await payoutFor(world.order.id, world.master.id)).amount, 600);
});

test('the B2B rate is not the B2C one — moving one must not move the other', async () => {
  await resetDb();
  const world = await seedHierarchy();
  // The B2C rate the client confirmed. It must not touch a trade order.
  await setConfig(CONFIG_KEYS.COMMISSION_PERCENT, 99);

  await deliver(world.order, world.distributor);

  assert.equal((await payoutFor(world.order.id, world.master.id)).amount, 450);
});

test('a tier share is config, and a per-industry override beats the global row', async () => {
  await resetDb();
  const world = await seedHierarchy();
  await setConfig(CONFIG_KEYS.TIER_SHARE_MASTER, 40);
  await setConfig(CONFIG_KEYS.TIER_SHARE_DISTRICT, 50, world.industry.id);

  await deliver(world.order, world.distributor);

  assert.equal((await payoutFor(world.order.id, world.master.id)).amount, 600); // 40% of 1500
  assert.equal((await payoutFor(world.order.id, world.district.id)).amount, 750); // 50% of 1500
});

test("a partner's own sharePercentage still beats the config default", async () => {
  await resetDb();
  const world = await seedHierarchy();
  await prisma.user.update({ where: { id: world.regional.id }, data: { sharePercentage: 5 } });

  await deliver(world.order, world.distributor);

  assert.equal((await payoutFor(world.order.id, world.regional.id)).amount, 75); // 5% of 1500
});

// --- the district revenue table ----------------------------------------------

test('the rider subscription row is gone, not relabelled', async () => {
  await resetDb();
  const world = await seedHierarchy();
  await makeUser('EXECUTIVE', { ...TERRITORY, executiveType: 'DELIVERY', industryId: world.industry.id });

  const res = await request(app).get('/api/district/revenue').set(auth(world.district));
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const keys = res.body.rows.map((r) => r.key);
  assert.ok(!keys.includes('delivery'), 'a platform pays its riders, it does not bill them');
  assert.deepEqual(keys, ['regions', 'shops', 'distributors', 'manufacturers']);

  // And the drill-down route is gone with it.
  const gone = await request(app).get('/api/district/revenue/delivery').set(auth(world.district));
  assert.equal(gone.status, 404);
});

test('subscription fees come from config, and the shares from the tier row', async () => {
  await resetDb();
  const world = await seedHierarchy();
  // A fee is only ever what somebody set — there is no code fallback to lean on.
  await setConfig(CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP, 3000);

  const before = await request(app).get('/api/district/revenue').set(auth(world.district));
  const shops = before.body.rows.find((r) => r.key === 'shops');
  assert.equal(shops.feePerPartner, 3000, 'the figure the client gave on 2026-08-07');
  assert.equal(shops.count, 1);
  assert.equal(shops.sharePct, 20);
  // ⚠️ Changed 2026-08-09, when subscription billing was built. `basis` was
  // `UNBILLED_FEE` and `totalCollected` was fee × headcount — a projection this
  // dashboard had to tag "NOT BILLED" because nothing could bill it (§7bis.1).
  // Now `totalCollected` is paid invoices on every row, and the projection has
  // its own field. Nobody has paid here, so it is 0 — which is a true statement
  // rather than the invented one it replaces.
  assert.equal(shops.basis, 'BILLED');
  assert.equal(shops.totalCollected, 0, 'nobody has paid an invoice');
  assert.equal(shops.projectedCollected, 3000, 'fee × active partners, kept and labelled');

  await setConfig(CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP, 7500);
  await setConfig(CONFIG_KEYS.TIER_SHARE_DISTRICT, 30);

  const after = await request(app).get('/api/district/revenue').set(auth(world.district));
  const updated = after.body.rows.find((r) => r.key === 'shops');
  assert.equal(updated.feePerPartner, 7500);
  assert.equal(updated.projectedCollected, 7500);
  assert.equal(updated.sharePct, 30);
  assert.equal(updated.projectedEarnings, 2250);
});

test('a fee nobody has set shows as unset, for every partner type', async () => {
  await resetDb();
  const world = await seedHierarchy();

  // The trap this replaces: shop and distributor used to fall back to 5000 and
  // 10000 in code, and both of those turned out to be the wrong price. A
  // dashboard quoting a number nobody chose is worse than one quoting nothing.
  const res = await request(app).get('/api/district/revenue').set(auth(world.district));
  for (const key of ['shops', 'distributors', 'manufacturers']) {
    const row = res.body.rows.find((r) => r.key === key);
    assert.equal(row.feeConfigured, false, `${key} must not invent a price`);
    assert.equal(row.feePerPartner, null);
  }
});

test("the manufacturer's fee is unset, not zero — the two must not look alike", async () => {
  await resetDb();
  const world = await seedHierarchy();
  await makeUser('MANUFACTURER', { ...TERRITORY, industryId: world.industry.id });

  const res = await request(app).get('/api/district/revenue').set(auth(world.district));
  const row = res.body.rows.find((r) => r.key === 'manufacturers');

  assert.equal(row.count, 1, 'the manufacturer is counted');
  // Nobody has given a figure (HANDOFF §7.1). The dashboard renders "—" off
  // this flag; a 0 fee would render as "free", which is a different claim.
  assert.equal(row.feeConfigured, false);
  assert.equal(row.feePerPartner, null);

  // Setting it makes it real, with no code change.
  await setConfig(CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER, 20000);
  const priced = await request(app).get('/api/district/revenue').set(auth(world.district));
  const now = priced.body.rows.find((r) => r.key === 'manufacturers');
  assert.equal(now.feeConfigured, true);
  assert.equal(now.feePerPartner, 20000);
  // The *projection* moves with the fee. `totalCollected` does not, because it
  // is paid invoices now — see the note in the fee test above.
  assert.equal(now.projectedCollected, 20000);
  assert.equal(now.totalCollected, 0);
});

test('the manufacturer drill-down works, and says the fee is not set', async () => {
  await resetDb();
  const world = await seedHierarchy();
  await makeUser('MANUFACTURER', { ...TERRITORY, industryId: world.industry.id });

  const res = await request(app).get('/api/district/revenue/manufacturers').set(auth(world.district));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.category.feeConfigured, false);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].revenue, 0);
  assert.ok(res.body.notice, 'an unbilled projection always carries its notice');
});
