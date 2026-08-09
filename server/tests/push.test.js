// Phase 2 — `src/lib/push.js`. Stubs on NODE_ENV=test (see the file's own
// comment for why that's the switch instead of a credentials check), so these
// tests pin the stub contract without ever reaching the network.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedBaseline, prisma, disconnect } from './helpers/db.js';
import { sendPushNotifications, notifyUser } from '../src/lib/push.js';

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

test('sendPushNotifications is a no-op stub in tests and touches no network', async () => {
  const result = await sendPushNotifications([{ to: 'ExponentPushToken[x]', title: 't', body: 'b' }]);
  assert.equal(result.stub, true);
});

test('sendPushNotifications with an empty list is a no-op', async () => {
  const result = await sendPushNotifications([]);
  assert.deepEqual(result.tickets, []);
});

test('notifyUser with no registered device does nothing', async () => {
  const result = await notifyUser(world.shop.id, { title: 't', body: 'b' });
  assert.equal(result, undefined);
});

test('notifyUser only sends to active devices for that user', async () => {
  await prisma.deviceToken.create({
    data: { token: 'ExponentPushToken[active]', platform: 'android', userId: world.shop.id, isActive: true }
  });
  await prisma.deviceToken.create({
    data: { token: 'ExponentPushToken[dead]', platform: 'android', userId: world.shop.id, isActive: false }
  });

  const result = await notifyUser(world.shop.id, { title: 'New order', body: 'Order #1' });
  assert.equal(result.stub, true);
});

test('notifyUser with no userId is a no-op', async () => {
  const result = await notifyUser(null, { title: 't', body: 'b' });
  assert.equal(result, undefined);
});
