// `PATCH /api/auth/me` — a partner changing their own display name.
//
// The happy path is one line of Prisma, so it is not what these test. What is
// worth pinning is the blast radius: the endpoint must set `name` and *nothing
// else*, must not become a second door onto the sign-in identifiers, and must
// not be reachable by the roles that have no dashboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';

async function seedPartner(role, overrides = {}) {
  return prisma.user.create({
    data: {
      email: `partner-${Math.random().toString(36).slice(2)}@test.roadmate`,
      password: await bcrypt.hash('test1234', 4),
      name: 'Narendra Kumar',
      role,
      isActive: true,
      ...overrides
    }
  });
}

test.after(disconnect);

test('a partner renames themselves, and the session reflects it', async () => {
  await resetDb();
  const { master } = await seedBaseline();

  const res = await request(app)
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${tokenFor(master)}`)
    .send({ name: 'Ravi Shankar' });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, 'Ravi Shankar');

  // The client stores this response as its whole session, so a narrower
  // projection here would silently drop fields the dashboards read.
  assert.equal(res.body.user.id, master.id);
  assert.equal(res.body.user.email, master.email);
  assert.equal(res.body.user.role, 'MASTER');

  // And `GET /api/auth/me` agrees — the write landed, it was not just echoed.
  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${tokenFor(master)}`);
  assert.equal(me.body.user.name, 'Ravi Shankar');
});

test('all seven dashboard roles can rename themselves', async () => {
  await resetDb();
  await seedBaseline();

  for (const role of ['MASTER', 'STATE', 'IND_STATE', 'DISTRICT', 'REGIONAL', 'MANUFACTURER', 'DISTRIBUTOR']) {
    const user = await seedPartner(role);
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: `Renamed ${role}` });

    assert.equal(res.status, 200, `${role} was refused: ${res.body.message}`);
    assert.equal(res.body.user.name, `Renamed ${role}`);
  }
});

test('a shop and a rider have no dashboard, and no rename', async () => {
  await resetDb();
  const { shop } = await seedBaseline();
  const rider = await seedPartner('EXECUTIVE', { executiveType: 'DELIVERY' });

  for (const user of [shop, rider]) {
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ name: 'Someone Else' });

    assert.equal(res.status, 403, `${user.role} should not reach this endpoint`);
  }

  // Neither row moved.
  const after = await prisma.user.findUnique({ where: { id: shop.id } });
  assert.equal(after.name, 'Test Shop');
});

test('the endpoint sets the name and nothing else', async () => {
  await resetDb();
  const { master } = await seedBaseline();
  const other = await seedPartner('STATE', { stateName: 'Telangana' });

  const res = await request(app)
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${tokenFor(other)}`)
    .send({
      name: 'Srinivas Reddy',
      // Everything a caller might hope to smuggle in: the sign-in identifiers,
      // the hierarchy, and the approval state.
      email: master.email,
      phone: '9876500011',
      role: 'MASTER',
      isActive: false,
      parentId: null,
      stateName: 'Karnataka',
      password: 'hunter2'
    });

  assert.equal(res.status, 200);

  const after = await prisma.user.findUnique({ where: { id: other.id } });
  assert.equal(after.name, 'Srinivas Reddy');
  assert.notEqual(after.email, master.email);
  assert.equal(after.phone, null);
  assert.equal(after.role, 'STATE');
  assert.equal(after.isActive, true);
  assert.equal(after.stateName, 'Telangana');

  // The password is still the one they signed in with.
  assert.equal(await bcrypt.compare('test1234', after.password), true);
});

test('whitespace is collapsed, so the sidebar renders what was meant', async () => {
  await resetDb();
  const { master } = await seedBaseline();

  const res = await request(app)
    .patch('/api/auth/me')
    .set('Authorization', `Bearer ${tokenFor(master)}`)
    .send({ name: '   Ravi    Shankar  ' });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, 'Ravi Shankar');
});

test('a name cannot be blanked or padded out to nothing', async () => {
  await resetDb();
  const { master } = await seedBaseline();

  for (const name of ['', '   ', 'A', null, 42, undefined, 'x'.repeat(81)]) {
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(master)}`)
      .send({ name });

    assert.equal(res.status, 400, `should have refused ${JSON.stringify(name)}`);
  }

  const after = await prisma.user.findUnique({ where: { id: master.id } });
  assert.equal(after.name, 'Test Master');
});

test('an anonymous caller cannot rename anybody', async () => {
  await resetDb();
  await seedBaseline();

  const res = await request(app).patch('/api/auth/me').send({ name: 'Nobody' });
  assert.equal(res.status, 401);
});
