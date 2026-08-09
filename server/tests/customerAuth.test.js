// Phase 1.1 — customer phone + OTP auth, and the `protectCustomer` guard.
//
// The SMS provider does not exist yet (client has not paid for MSG91/Twilio), so
// under NODE_ENV=test the request endpoint returns the code in the response.
// Everything else — hashing, expiry, attempt limits, consumption, the JWT — is real.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect } from './helpers/db.js';

const PHONE = '9876543210';

let world;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
});

after(async () => {
  await disconnect();
});

/** Request an OTP and return the plaintext code the test-mode response exposes. */
async function requestOtp(phone = PHONE) {
  const res = await request(app).post('/api/customer/auth/otp/request').send({ phone });
  assert.equal(res.status, 200, `otp/request failed: ${JSON.stringify(res.body)}`);
  return res.body.code;
}

// --- request -----------------------------------------------------------------

test('otp/request creates a token and never stores the code in plaintext', async () => {
  const code = await requestOtp();

  assert.match(code, /^\d{6}$/);

  const rows = await prisma.otpToken.findMany({ where: { phone: PHONE } });
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].codeHash, code);
  assert.ok(rows[0].expiresAt > new Date());
});

test('otp/request rejects a malformed phone number', async () => {
  const res = await request(app).post('/api/customer/auth/otp/request').send({ phone: '123' });
  assert.equal(res.status, 400);
  assert.equal(await prisma.otpToken.count(), 0);
});

test('otp/request is rate limited per phone', async () => {
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await request(app).post('/api/customer/auth/otp/request').send({ phone: PHONE });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429, 'expected repeated requests for one phone to be throttled');
});

test('otp/request does not leak the code outside test/development', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await request(app).post('/api/customer/auth/otp/request').send({ phone: PHONE });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, undefined);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

// --- verify ------------------------------------------------------------------

test('otp/verify creates the customer on first login and issues a token', async () => {
  const code = await requestOtp();

  const res = await request(app)
    .post('/api/customer/auth/otp/verify')
    .send({ phone: PHONE, code });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.customer.phone, PHONE);
  assert.equal(res.body.isNewCustomer, true);

  const consumed = await prisma.otpToken.findFirst({ where: { phone: PHONE } });
  assert.ok(consumed.consumedAt, 'the token must be consumed');
});

test('otp/verify reuses the existing customer on a later login', async () => {
  const first = await requestOtp();
  const a = await request(app).post('/api/customer/auth/otp/verify').send({ phone: PHONE, code: first });

  const second = await requestOtp();
  const b = await request(app).post('/api/customer/auth/otp/verify').send({ phone: PHONE, code: second });

  assert.equal(b.status, 200);
  assert.equal(b.body.isNewCustomer, false);
  assert.equal(b.body.customer.id, a.body.customer.id);
  assert.equal(await prisma.customer.count(), 1);
});

test('otp/verify rejects a wrong code and counts the attempt', async () => {
  await requestOtp();

  const res = await request(app)
    .post('/api/customer/auth/otp/verify')
    .send({ phone: PHONE, code: '000000' });

  assert.equal(res.status, 401);
  assert.equal(res.body.token, undefined);

  const row = await prisma.otpToken.findFirst({ where: { phone: PHONE } });
  assert.equal(row.attempts, 1);
  assert.equal(row.consumedAt, null);
  assert.equal(await prisma.customer.count(), 0);
});

test('otp/verify locks the token out after too many wrong codes', async () => {
  const code = await requestOtp();

  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await request(app)
      .post('/api/customer/auth/otp/verify')
      .send({ phone: PHONE, code: '000000' });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429, 'expected the token to lock out');

  // Even the correct code must not work once the token is burned.
  const res = await request(app)
    .post('/api/customer/auth/otp/verify')
    .send({ phone: PHONE, code });
  assert.notEqual(res.status, 200);
});

test('otp/verify rejects an expired code', async () => {
  const code = await requestOtp();
  await prisma.otpToken.updateMany({
    where: { phone: PHONE },
    data: { expiresAt: new Date(Date.now() - 1000) }
  });

  const res = await request(app).post('/api/customer/auth/otp/verify').send({ phone: PHONE, code });
  assert.equal(res.status, 401);
  assert.equal(await prisma.customer.count(), 0);
});

test('otp/verify rejects a code that was already consumed', async () => {
  const code = await requestOtp();
  await request(app).post('/api/customer/auth/otp/verify').send({ phone: PHONE, code });

  const res = await request(app).post('/api/customer/auth/otp/verify').send({ phone: PHONE, code });
  assert.equal(res.status, 401);
});

test('otp/verify refuses a blocked customer', async () => {
  await prisma.customer.create({ data: { phone: PHONE, isBlocked: true } });
  const code = await requestOtp();

  const res = await request(app).post('/api/customer/auth/otp/verify').send({ phone: PHONE, code });
  assert.equal(res.status, 403);
  assert.equal(res.body.token, undefined);
});

// --- protectCustomer ---------------------------------------------------------

test('GET /api/customer/me returns the signed-in customer', async () => {
  const code = await requestOtp();
  const login = await request(app).post('/api/customer/auth/otp/verify').send({ phone: PHONE, code });

  const res = await request(app)
    .get('/api/customer/me')
    .set('Authorization', `Bearer ${login.body.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.customer.phone, PHONE);
});

test('customer routes reject a missing token', async () => {
  const res = await request(app).get('/api/customer/me');
  assert.equal(res.status, 401);
});

test('a staff token cannot be used on a customer route', async () => {
  const res = await request(app)
    .get('/api/customer/me')
    .set('Authorization', `Bearer ${tokenFor(world.master)}`);

  assert.equal(res.status, 401);
});

test('a customer token cannot be used on a staff route', async () => {
  const customer = await prisma.customer.create({ data: { phone: PHONE } });

  const res = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${customerTokenFor(customer)}`);

  assert.equal(res.status, 401);
});

test('a customer blocked after login can no longer use their token', async () => {
  const customer = await prisma.customer.create({ data: { phone: PHONE } });
  const token = customerTokenFor(customer);

  await prisma.customer.update({ where: { id: customer.id }, data: { isBlocked: true } });

  const res = await request(app).get('/api/customer/me').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('a token for a deleted customer is rejected', async () => {
  const customer = await prisma.customer.create({ data: { phone: PHONE } });
  const token = customerTokenFor(customer);
  await prisma.customer.delete({ where: { id: customer.id } });

  const res = await request(app).get('/api/customer/me').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 401);
});
