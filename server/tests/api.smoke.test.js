// Proves the harness works end to end: real HTTP against the real app, against
// a real (test) Postgres. If this file passes, Phase 1 can be written test-first.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, disconnect } from './helpers/db.js';

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

test('GET /api/health is public and returns ok', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('GET /api/industries lists seeded industries without auth', async () => {
  const res = await request(app).get('/api/industries');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.industries.map((i) => i.slug), ['grocery']);
});

test('POST /api/auth/login issues a token for valid credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: world.master.email, password: world.password });

  assert.equal(res.status, 200);
  assert.ok(res.body.token, 'expected a JWT');
  assert.equal(res.body.user.role, 'MASTER');
});

test('POST /api/auth/login rejects a wrong password', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: world.master.email, password: 'wrong-password' });

  assert.equal(res.status, 401);
  assert.equal(res.body.token, undefined);
});

test('protected routes reject a missing token', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('protected routes accept a valid token', async () => {
  const res = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${tokenFor(world.master)}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, world.master.email);
});

test('an inactive user cannot use an otherwise valid token', async () => {
  const { prisma } = await import('./helpers/db.js');
  await prisma.user.update({ where: { id: world.master.id }, data: { isActive: false } });

  const res = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${tokenFor(world.master)}`);

  assert.equal(res.status, 403);
});
