// The Master settings API — `/api/master/config`.
//
// Everything tunable in the platform already lived in `PlatformConfig` and was
// already read through `getConfigNumber()`. What was missing was any way to
// change one without a developer running a script, which is what made every
// commercial answer the client gave ("set it from the dashboard at the end")
// undeliverable. This file pins the three rules that make it safe to expose:
// MASTER only, known keys only, and unset ≠ zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import { getConfigNumber, CONFIG_KEYS } from '../src/lib/platformConfig.js';

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

let master;
let industry;

async function world() {
  await resetDb();
  const base = await seedBaseline();
  industry = base.industry;
  master = base.master;
  return base;
}

const findKey = (body, key) =>
  body.groups.flatMap((g) => g.keys).find((k) => k.key === key);

test.after(disconnect);

test('every key is listed, grouped, with its default and what is actually set', async () => {
  await world();

  const res = await request(app).get('/api/master/config').set(auth(master));
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const keys = res.body.groups.flatMap((g) => g.keys);
  assert.equal(keys.length, Object.values(CONFIG_KEYS).length, 'every key reaches the screen');
  assert.ok(res.body.groups.length > 1, 'grouped, not one flat list');

  // seedBaseline writes commission_percent = 15 as a real row.
  const commission = findKey(res.body, CONFIG_KEYS.COMMISSION_PERCENT);
  assert.equal(commission.value, 15);
  assert.equal(commission.isSet, true);
  assert.equal(commission.effective, 15);
  assert.equal(commission.label, 'Platform commission');
  assert.equal(commission.unit, '%');

  // A key with a documented default and no row: the screen must be able to say
  // "nobody chose this, here is what the code does".
  const eta = findKey(res.body, CONFIG_KEYS.BASE_ETA_MIN);
  assert.equal(eta.value, null);
  assert.equal(eta.isSet, false);
  assert.equal(eta.default, 10);
  assert.equal(eta.effective, 10);
});

test('no partner fee has a code default — a price is said, or it is nothing', async () => {
  await world();

  const res = await request(app).get('/api/master/config').set(auth(master));

  // Shop and distributor used to fall back to 5000 and 10000 in code. The
  // client's real figures (2026-08-07) were 3000 and 5000, so those fallbacks
  // had been quoting the wrong price on a live dashboard without looking wrong.
  for (const key of [
    CONFIG_KEYS.SUBSCRIPTION_FEE_SHOP,
    CONFIG_KEYS.SUBSCRIPTION_FEE_DISTRIBUTOR,
    CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER
  ]) {
    const fee = findKey(res.body, key);
    assert.equal(fee.hasDefault, false, `${key} must have no invented fallback`);
    assert.equal(fee.effective, null, 'renders "—", not ₹0');
  }
});

test('saving a value writes it, and the pipeline reads it immediately', async () => {
  await world();

  const res = await request(app)
    .put('/api/master/config')
    .set(auth(master))
    .send({ key: CONFIG_KEYS.DELIVERY_FEE, value: 25 });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await getConfigNumber(CONFIG_KEYS.DELIVERY_FEE), 25);
});

test('a per-industry override is its own row and beats the global one', async () => {
  await world();

  await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.TAX_PERCENT, value: 5 });
  await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.TAX_PERCENT, value: 18, industryId: industry.id });

  assert.equal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT), 5);
  assert.equal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT, industry.id), 18);

  const res = await request(app).get('/api/master/config').set(auth(master));
  const tax = findKey(res.body, CONFIG_KEYS.TAX_PERCENT);
  assert.equal(tax.value, 5);
  assert.equal(tax.overrides.length, 1);
  assert.equal(tax.overrides[0].value, 18);
  assert.equal(tax.overrides[0].industryName, industry.name);
});

test('a batch saves what it can name and rejects an unknown key outright', async () => {
  await world();

  const ok = await request(app).put('/api/master/config').set(auth(master)).send({
    updates: [
      { key: CONFIG_KEYS.RIDER_BASE_FEE, value: 20 },
      { key: CONFIG_KEYS.RIDER_PER_KM_FEE, value: 6 }
    ]
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.applied.length, 2);
  assert.equal(await getConfigNumber(CONFIG_KEYS.RIDER_BASE_FEE), 20);

  // `PlatformConfig` is a free-form key/value table, so a typo would otherwise
  // create a row nothing ever reads — indistinguishable from a setting that
  // silently did not take effect.
  const bad = await request(app).put('/api/master/config').set(auth(master))
    .send({ key: 'comission_percent', value: 30 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, 'UNKNOWN_KEY');
  assert.equal(await prisma.platformConfig.count({ where: { key: 'comission_percent' } }), 0);
});

test('a value that is not a number is refused', async () => {
  await world();

  const res = await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.COMMISSION_PERCENT, value: 'fifteen' });

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'BAD_VALUE');
  assert.equal(await getConfigNumber(CONFIG_KEYS.COMMISSION_PERCENT), 15, 'unchanged');
});

test('blank clears the row; it does not write a zero', async () => {
  await world();

  await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER, value: 20000 });
  assert.equal(await getConfigNumber(CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER), 20000);

  const cleared = await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER, value: '' });

  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.applied[0].cleared, true);
  // Back to "nobody has decided" — not "it is free".
  assert.equal(await getConfigNumber(CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER), null);
  assert.equal(await prisma.platformConfig.count({
    where: { key: CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER }
  }), 0);
});

test('zero is a real answer, and is kept', async () => {
  await world();

  await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER, value: 0 });

  const res = await request(app).get('/api/master/config').set(auth(master));
  const fee = findKey(res.body, CONFIG_KEYS.SUBSCRIPTION_FEE_MANUFACTURER);
  assert.equal(fee.isSet, true);
  assert.equal(fee.value, 0, 'somebody decided it is free — a different claim from "unset"');
});

test('deleting an override falls back to the global row', async () => {
  await world();

  await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.TAX_PERCENT, value: 5 });
  await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.TAX_PERCENT, value: 18, industryId: industry.id });

  const res = await request(app)
    .delete(`/api/master/config/${CONFIG_KEYS.TAX_PERCENT}?industryId=${industry.id}`)
    .set(auth(master));

  assert.equal(res.status, 200);
  assert.equal(res.body.removed, 1);
  assert.equal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT, industry.id), 5);
});

test('an override for an industry that does not exist is refused', async () => {
  await world();

  const res = await request(app).put('/api/master/config').set(auth(master))
    .send({ key: CONFIG_KEYS.TAX_PERCENT, value: 18, industryId: 999999 });

  assert.equal(res.status, 404);
  assert.equal(res.body.reason, 'BAD_INDUSTRY');
});

test('saving twice leaves one row, not two', async () => {
  await world();

  for (const value of [10, 12, 15]) {
    await request(app).put('/api/master/config').set(auth(master))
      .send({ key: CONFIG_KEYS.B2B_COMMISSION_PERCENT, value });
  }

  // Postgres cannot enforce this — NULL industryIds are distinct — so `setConfig`
  // has to, and the settings screen is the thing most likely to test it.
  assert.equal(await prisma.platformConfig.count({
    where: { key: CONFIG_KEYS.B2B_COMMISSION_PERCENT, industryId: null }
  }), 1);
  assert.equal(await getConfigNumber(CONFIG_KEYS.B2B_COMMISSION_PERCENT), 15);
});

test('nobody but MASTER can read or change platform settings', async () => {
  await world();
  const shop = await prisma.user.findFirst({ where: { role: 'SHOP' } });
  const district = await prisma.user.create({
    data: {
      email: 'district@test.roadmate',
      password: bcrypt.hashSync('test1234', 4),
      name: 'District',
      role: 'DISTRICT',
      isActive: true
    }
  });

  for (const user of [shop, district]) {
    assert.equal((await request(app).get('/api/master/config').set(auth(user))).status, 403);
    assert.equal(
      (await request(app).put('/api/master/config').set(auth(user))
        .send({ key: CONFIG_KEYS.COMMISSION_PERCENT, value: 1 })).status,
      403
    );
    assert.equal(
      (await request(app).delete(`/api/master/config/${CONFIG_KEYS.COMMISSION_PERCENT}`)
        .set(auth(user))).status,
      403
    );
  }

  assert.equal(await getConfigNumber(CONFIG_KEYS.COMMISSION_PERCENT), 15);
});

test('signing out is signing out — no token, no settings', async () => {
  await world();
  assert.equal((await request(app).get('/api/master/config')).status, 401);
});
