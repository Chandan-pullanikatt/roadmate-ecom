// Staff sign-in by phone number **or** email address (client confirmed
// 2026-08-07: "also", not "instead").
//
// The three things worth a test here are not the happy path. They are the ways
// this change could quietly break something that already worked:
//
//   1. The 7 web dashboards post `{ email, password }` and must keep working.
//   2. Existing sessions must not be invalidated — the token is signed exactly
//      as before, so a JWT minted before this change still authenticates.
//   3. `User.phone` is now unique, and it only means "one human, one row"
//      because every write normalises first. A test that only checks
//      "9876500011 signs in" would pass on a broken normaliser.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import { normalizePhone, looksLikePhone } from '../src/lib/phone.js';

const PASSWORD = 'test1234';

async function seedStaffWithPhone(phone, overrides = {}) {
  return prisma.user.create({
    data: {
      email: `staff-${Math.random().toString(36).slice(2)}@test.roadmate`,
      password: await bcrypt.hash(PASSWORD, 4),
      name: 'Phone Shop',
      role: 'SHOP',
      isActive: true,
      phone,
      ...overrides
    }
  });
}

test.after(disconnect);

// --- the normaliser itself ---------------------------------------------------

test('one human is one number, however they type it', () => {
  for (const input of ['9876500011', '+919876500011', '+91 98765 00011', '098765-00011', '91 9876500011']) {
    assert.equal(normalizePhone(input), '9876500011', `failed on ${input}`);
  }
});

test('the normaliser refuses what is not an Indian mobile number', () => {
  // Leading 1-5 is not mobile numbering; 9 and 11 digits are not numbers at all.
  for (const input of ['1234567890', '5876500011', '987650001', '98765000112', '', 'shop@x.in', null]) {
    assert.equal(normalizePhone(input), null, `should have refused ${input}`);
  }
});

test('an email is never mistaken for a phone attempt', () => {
  assert.equal(looksLikePhone('shop@test.roadmate'), false);
  // A mistyped email with no @ is still an email attempt, not a phone lookup —
  // otherwise it fails with the wrong reason.
  assert.equal(looksLikePhone('shoptest.roadmate'), false);
  assert.equal(looksLikePhone('+91 98765 00011'), true);
  assert.equal(looksLikePhone('9876500011'), true);
});

// --- the endpoint ------------------------------------------------------------

test('a shop signs in with its phone number', async () => {
  await resetDb();
  await seedBaseline();
  const staff = await seedStaffWithPhone('9876500011');

  const res = await request(app)
    .post('/api/auth/login')
    .send({ identifier: '9876500011', password: PASSWORD });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, staff.id);
  assert.ok(res.body.token);
});

test('the phone number works however it is typed', async () => {
  await resetDb();
  await seedBaseline();
  const staff = await seedStaffWithPhone('9876500011');

  for (const typed of ['+919876500011', '+91 98765 00011', '098765 00011', '91-9876500011']) {
    const res = await request(app).post('/api/auth/login').send({ identifier: typed, password: PASSWORD });
    assert.equal(res.status, 200, `failed on ${typed}: ${res.body.message}`);
    assert.equal(res.body.user.id, staff.id);
  }
});

test('the 7 web dashboards keep working — { email, password } is untouched', async () => {
  await resetDb();
  const { shop } = await seedBaseline();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'shop@test.roadmate', password: PASSWORD });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, shop.id);
});

test('an email address still works through the new `identifier` field too', async () => {
  await resetDb();
  const { shop } = await seedBaseline();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ identifier: 'shop@test.roadmate', password: PASSWORD });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, shop.id);
});

test('existing sessions are not invalidated', async () => {
  await resetDb();
  const { shop } = await seedBaseline();

  // A token minted the way it always was — i.e. one a shop is already holding.
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(shop)}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, shop.id);
});

test('every failure looks the same — no enumerating who is on the platform', async () => {
  await resetDb();
  await seedBaseline();
  await seedStaffWithPhone('9876500011');

  const cases = [
    { identifier: '9876500011', password: 'wrong' }, // right phone, wrong password
    { identifier: '9000000000', password: PASSWORD }, // no such phone
    { identifier: 'nobody@test.roadmate', password: PASSWORD }, // no such email
    { identifier: '12345', password: PASSWORD } // not a valid number at all
  ];

  const bodies = [];
  for (const body of cases) {
    const res = await request(app).post('/api/auth/login').send(body);
    assert.equal(res.status, 401, `expected 401 for ${JSON.stringify(body)}`);
    bodies.push(res.body.message);
  }

  assert.equal(new Set(bodies).size, 1, `messages differed: ${JSON.stringify(bodies)}`);
});

test('an inactive account is still refused, by phone as well as by email', async () => {
  await resetDb();
  await seedBaseline();
  await seedStaffWithPhone('9876500012', { isActive: false });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ identifier: '9876500012', password: PASSWORD });

  assert.equal(res.status, 403);
});

test('a phone number cannot be claimed twice', async () => {
  await resetDb();
  await seedBaseline();
  await seedStaffWithPhone('9876500011');

  // The database is the backstop, not just the controller check — this is the
  // constraint that makes "one human is one row" true even for a writer that
  // forgets to look first.
  await assert.rejects(() => seedStaffWithPhone('9876500011'), /Unique constraint|P2002/);
});

test('accounts without a phone number are still legal, and there can be many', async () => {
  await resetDb();
  await seedBaseline();

  // 23 of the 34 live rows have no phone. NULLs are distinct in a Postgres
  // unique index, and this pins that they stay that way.
  await seedStaffWithPhone(null);
  await seedStaffWithPhone(null);

  const count = await prisma.user.count({ where: { phone: null } });
  assert.ok(count >= 3, `expected several phone-less accounts, got ${count}`);
});

// --- partner creation normalises on the way in -------------------------------

test('creating a partner stores the normalised number, so they can sign in with it', async () => {
  await resetDb();
  const { master } = await seedBaseline();

  const res = await request(app)
    .post('/api/partners/create')
    .set('Authorization', `Bearer ${tokenFor(master)}`)
    .send({
      role: 'SHOP',
      email: 'newshop@test.roadmate',
      name: 'New Shop',
      phone: '+91 98765 00099',
      password: PASSWORD,
      // Required for a SHOP since Phase A.1 — a shop without coordinates is
      // invisible to every customer. Incidental here; this test is about the
      // phone number.
      latitude: 12.9716,
      longitude: 77.5946
    });

  assert.equal(res.status, 201);
  const created = await prisma.user.findUnique({ where: { email: 'newshop@test.roadmate' } });
  assert.equal(created.phone, '9876500099');

  // The whole point: the number they gave at onboarding is the one that works.
  const login = await request(app)
    .post('/api/auth/login')
    .send({ identifier: '+919876500099', password: PASSWORD });
  assert.equal(login.status, 200);
});

test('a malformed phone number is refused at onboarding, not stored unusable', async () => {
  await resetDb();
  const { master } = await seedBaseline();

  const res = await request(app)
    .post('/api/partners/create')
    .set('Authorization', `Bearer ${tokenFor(master)}`)
    .send({ role: 'SHOP', email: 'bad@test.roadmate', name: 'Bad', phone: '12345', password: PASSWORD });

  assert.equal(res.status, 400);
  assert.equal(await prisma.user.findUnique({ where: { email: 'bad@test.roadmate' } }), null);
});

test('a partner with no phone number can still be onboarded', async () => {
  await resetDb();
  const { master } = await seedBaseline();

  const res = await request(app)
    .post('/api/partners/create')
    .set('Authorization', `Bearer ${tokenFor(master)}`)
    .send({
      role: 'SHOP',
      email: 'nophone@test.roadmate',
      name: 'No Phone',
      password: PASSWORD,
      latitude: 12.9716,
      longitude: 77.5946
    });

  assert.equal(res.status, 201);
  const created = await prisma.user.findUnique({ where: { email: 'nophone@test.roadmate' } });
  assert.equal(created.phone, null);
});

// --- approvedAt: the trial clock ---------------------------------------------

test('approving a partner records when it happened', async () => {
  await resetDb();
  const { master } = await seedBaseline();
  const pending = await seedStaffWithPhone('9876500013', { isActive: false });
  assert.equal(pending.approvedAt, null);

  const before = Date.now();
  const res = await request(app)
    .post(`/api/partners/${pending.id}/approve`)
    .set('Authorization', `Bearer ${tokenFor(master)}`);
  assert.equal(res.status, 200);

  const after = await prisma.user.findUnique({ where: { id: pending.id } });
  assert.equal(after.isActive, true);
  assert.ok(after.approvedAt, 'approvedAt should be stamped');
  assert.ok(after.approvedAt.getTime() >= before - 1000);
});

test('re-approving does not restart the trial clock', async () => {
  await resetDb();
  const { master } = await seedBaseline();
  const pending = await seedStaffWithPhone('9876500014', { isActive: false });

  const auth = `Bearer ${tokenFor(master)}`;
  await request(app).post(`/api/partners/${pending.id}/approve`).set('Authorization', auth);
  const first = (await prisma.user.findUnique({ where: { id: pending.id } })).approvedAt;

  await new Promise((r) => setTimeout(r, 25));
  await request(app).post(`/api/partners/${pending.id}/approve`).set('Authorization', auth);
  const second = (await prisma.user.findUnique({ where: { id: pending.id } })).approvedAt;

  // The endpoint is idempotent by design (PLAN §3 — approve is not a claim), so
  // a second tap must be a no-op for the date a 3-month trial counts from.
  assert.equal(first.getTime(), second.getTime());
});
