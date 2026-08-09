// Push registration. The 60-second accept timer is only real if the shop's
// phone buzzes, so this table is on the Phase 1 critical path.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedBaseline, disconnect, prisma } from './helpers/db.js';

let world;

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
});

after(async () => {
  await disconnect();
});

test('a shop can register a device token', async () => {
  const dt = await prisma.deviceToken.create({
    data: { token: 'ExponentPushToken[aaa]', platform: 'android', userId: world.shop.id }
  });
  assert.equal(dt.isActive, true);
  assert.equal(dt.customerId, null);
});

test('re-registering the same token is idempotent, not a duplicate', async () => {
  const data = {
    token: 'ExponentPushToken[bbb]',
    platform: 'android',
    userId: world.shop.id
  };
  await prisma.deviceToken.upsert({
    where: { token: data.token },
    create: data,
    update: { userId: world.shop.id, isActive: true, lastSeenAt: new Date() }
  });
  await prisma.deviceToken.upsert({
    where: { token: data.token },
    create: data,
    update: { userId: world.shop.id, isActive: true, lastSeenAt: new Date() }
  });

  assert.equal(await prisma.deviceToken.count({ where: { token: data.token } }), 1);
});

test('a device cannot belong to both a User and a Customer', async () => {
  const customer = await prisma.customer.create({ data: { phone: '9000000002' } });

  await assert.rejects(
    prisma.deviceToken.create({
      data: {
        token: 'ExponentPushToken[ccc]',
        platform: 'ios',
        userId: world.shop.id,
        customerId: customer.id
      }
    }),
    /DeviceToken_owner_xor/
  );
});

test('a device cannot be ownerless', async () => {
  await assert.rejects(
    prisma.deviceToken.create({
      data: { token: 'ExponentPushToken[ddd]', platform: 'ios' }
    }),
    /DeviceToken_owner_xor/
  );
});

test('deleting a shop removes its device tokens', async () => {
  await prisma.deviceToken.create({
    data: { token: 'ExponentPushToken[eee]', platform: 'ios', userId: world.shop.id }
  });
  await prisma.user.delete({ where: { id: world.shop.id } });
  assert.equal(await prisma.deviceToken.count(), 0);
});
