// The contract the Rider app's screens read (Phase 3).
//
// The sibling of `tests/execApp.test.js`, and it exists for the same reason:
// bundling an Expo app proves the imports resolve and proves *nothing* about
// whether `job.pickup.name` is a field the API sends. The rider screens
// dereference a job card, an earnings summary and a cash summary field by field,
// and every one of those names is pinned here against a real database.
//
// It is not a controller test — `tests/delivery.test.js` and
// `tests/shopOwnRiders.test.js` own the pipeline's behaviour. This file asserts
// that the app and the API still agree, and it is what will fail if somebody
// reshapes a response later.
//
// Where a screen reads `a?.b ?? fallback`, the fallback is not tested: an
// optional field is allowed to be absent. Where a screen reads `a.b` outright,
// its absence is a crash in a rider's hand at somebody's front door, and that is
// what is pinned.
//
// Three things beyond field names are pinned deliberately, because each is a
// screen *decision* and not just a shape:
//
//   • `executiveType` on the session, because the door tells a DELIVERY
//     executive from a LISTING one with it — and a field executive signed in to
//     an empty job list is the failure the door exists to prevent.
//   • `isOnShift` on the session, because a cold start renders the toggle from
//     it, and guessing "off" invites a tap that turns a working shift off.
//   • the 403 `EMPLOYED_BY_SHOP` reason string, because the earnings screen
//     branches on that exact token rather than on the status alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import {
  createRider,
  createShop,
  createProduct,
  stockShop,
  createCustomer,
  createAddress
} from './helpers/factories.js';

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

/**
 * One order walked to READY, which is the state in which a delivery job exists
 * and is assigned. Everything the rider app renders hangs off this.
 */
async function seedAssignedJob({ employerShopId = null } = {}) {
  const { industry } = await seedBaseline();

  const shop = await createShop({
    industryId: industry.id,
    latitude: 12.9716,
    longitude: 77.5946,
    usesOwnRiders: employerShopId != null
  });
  // A shop's own boy is employed by *this* shop, so the caller passes a
  // sentinel and we substitute the real id once the shop exists.
  const rider = await createRider({
    lastLat: 12.9718,
    lastLng: 77.5948,
    isOnShift: true,
    employerShopId: employerShopId === 'SELF' ? shop.id : null,
    phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
  });

  const product = await createProduct({ industryId: industry.id, ownerId: shop.id });
  await stockShop({ shopId: shop.id, productId: product.id, quantity: 10, sellingPrice: 250 });

  const customer = await createCustomer();
  const address = await createAddress({ customerId: customer.id, latitude: 12.9726, longitude: 77.5956 });

  const order = await prisma.consumerOrder.create({
    data: {
      orderNumber: `RM-C-${Date.now()}`,
      customerId: customer.id,
      industryId: industry.id,
      shopId: shop.id,
      addressId: address.id,
      status: 'READY',
      subtotal: '250.00',
      taxAmount: '0.00',
      deliveryFee: '0.00',
      discountAmount: '0.00',
      grandTotal: '250.00',
      items: {
        create: [
          {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: '250.00'
          }
        ]
      },
      payment: {
        create: { method: 'COD', status: 'PENDING', amount: '250.00' }
      }
    },
    include: { items: true }
  });

  const job = await prisma.deliveryJob.create({
    data: {
      type: 'LAST_MILE',
      status: 'ASSIGNED',
      consumerOrderId: order.id,
      riderId: rider.id,
      assignedAt: new Date(),
      pickupLat: shop.latitude,
      pickupLng: shop.longitude,
      dropLat: address.latitude,
      dropLng: address.longitude,
      distanceKm: 1.2,
      otpCode: '4321'
    }
  });

  return { industry, shop, rider, order, job, address };
}

test('rider app · the session carries what the door and the shift toggle read', async (t) => {
  await resetDb();
  const { rider } = await seedAssignedJob();

  const me = await request(app).get('/api/auth/me').set(auth(rider)).expect(200);
  const user = me.body.user;

  // The door: `isRiderAccount` is role AND executiveType, because `EXECUTIVE`
  // is two different jobs and only one of them has this app.
  assert.equal(user.role, 'EXECUTIVE');
  assert.equal(user.executiveType, 'DELIVERY');

  // The shift toggle's initial state on a cold start.
  assert.equal(user.isOnShift, true);

  // A platform partner has no employer, and the earnings tab is rendered
  // *because* this is null.
  assert.equal(user.employerShopId, null);
  assert.equal(user.employerShop, null);

  assert.ok(typeof user.name === 'string');
});

test('rider app · sign-in returns the same shape as the session restore', async () => {
  await resetDb();
  const { rider } = await seedAssignedJob();

  // The reason this matters: `session.js` sets the user from `login` on
  // sign-in and from `me` on a cold restart. A field on one and not the other
  // is a screen that works until the app is reopened — or until it is not.
  const login = await request(app)
    .post('/api/auth/login')
    .send({ identifier: rider.email, password: 'test1234' })
    .expect(200);

  const me = await request(app).get('/api/auth/me').set(auth(rider)).expect(200);

  assert.deepEqual(Object.keys(login.body.user).sort(), Object.keys(me.body.user).sort());
  assert.equal(login.body.user.executiveType, 'DELIVERY');
  assert.equal(login.body.user.isOnShift, me.body.user.isOnShift);
});

test('rider app · a shop’s own delivery boy is told who employs him', async () => {
  await resetDb();
  const { rider, shop } = await seedAssignedJob({ employerShopId: 'SELF' });

  const me = await request(app).get('/api/auth/me').set(auth(rider)).expect(200);

  assert.equal(me.body.user.employerShopId, shop.id);
  // The *name*, not just the id — "You deliver for X" is what makes an app with
  // no earnings tab make sense, and the Profile screen reads exactly this.
  assert.ok(me.body.user.employerShop.name);
});

test('rider app · the job card has every field the screens dereference', async () => {
  await resetDb();
  const { rider, shop } = await seedAssignedJob();

  const res = await request(app).get('/api/rider/jobs').set(auth(rider)).expect(200);
  const [job] = res.body.jobs;

  assert.ok(job, 'the assigned job is listed');
  assert.equal(job.status, 'ASSIGNED');

  // `src/job.js` switches on these two.
  assert.equal(typeof job.status, 'string');
  assert.equal(typeof job.isDeadRun, 'boolean');

  // The pickup card: name, phone (optional), and coordinates for the maps link.
  assert.equal(job.pickup.shopId, shop.id);
  assert.ok(job.pickup.name);
  assert.equal(typeof job.pickup.latitude, 'number');
  assert.equal(typeof job.pickup.longitude, 'number');

  // The drop card: `formatAddress` joins these, and the maps link needs the pair.
  assert.ok(job.drop.line1);
  assert.equal(typeof job.drop.latitude, 'number');
  assert.equal(typeof job.drop.longitude, 'number');

  // The header and the cash panel.
  assert.ok(job.order.orderNumber);
  assert.equal(job.order.status, 'READY');
  assert.equal(job.order.itemCount, 1);
  assert.equal(job.order.paymentMethod, 'COD');
  // The one figure that costs the rider their own money if it is wrong. A
  // fixed-2 string, never a float — `formatINR` formats it as a string.
  assert.equal(job.order.collectAmount, '250.00');
});

test('rider app · a prepaid order tells the rider to collect nothing', async () => {
  await resetDb();
  const { rider, order } = await seedAssignedJob();

  await prisma.payment.update({
    where: { consumerOrderId: order.id },
    data: { method: 'PREPAID', status: 'PAID' }
  });

  const res = await request(app).get('/api/rider/jobs').set(auth(rider)).expect(200);
  // Null, not '0.00'. The screen branches on it to decide between the amber
  // "collect at the door" panel and "already paid online", and a zero-valued
  // string would render the wrong one.
  assert.equal(res.body.jobs[0].order.collectAmount, null);
});

test('rider app · the two-rung ladder, walked exactly as the screen walks it', async () => {
  await resetDb();
  const { rider, job } = await seedAssignedJob();

  // Rung one. `nextStep()` offers this for ASSIGNED / EN_ROUTE_PICKUP /
  // AT_PICKUP, and the API accepts all three — the middle two exist in the enum
  // but nothing ever sets them, which is why the app draws two rungs and not
  // four.
  const picked = await request(app)
    .post(`/api/rider/jobs/${job.id}/pickup`)
    .set(auth(rider))
    .expect(200);
  assert.equal(picked.body.job.status, 'EN_ROUTE_DROP');

  // Rung two, and the thing that is not a formality: the OTP.
  await request(app)
    .post(`/api/rider/jobs/${job.id}/deliver`)
    .set(auth(rider))
    .send({ otpCode: '0000' })
    .expect(422);

  const delivered = await request(app)
    .post(`/api/rider/jobs/${job.id}/deliver`)
    .set(auth(rider))
    .send({ otpCode: '4321', note: 'Handed to the customer' })
    .expect(200);

  assert.equal(delivered.body.job.status, 'DELIVERED');
  // Frozen at delivery and rendered as-is. The screen never recomputes a fee.
  assert.equal(typeof delivered.body.job.riderEarning, 'string');
});

test('rider app · proof of delivery rides along with the OTP, and is stored', async () => {
  await resetDb();
  const { rider, job } = await seedAssignedJob();

  await request(app).post(`/api/rider/jobs/${job.id}/pickup`).set(auth(rider)).expect(200);

  // What the app sends after `uploadAsset` returns: two URLs, on the same call
  // as the code. `deliver()` has taken both since Phase 1.7 — landing file
  // storage (2026-08-09) changed the app, not this endpoint.
  const photoUrl = 'https://example.test/pod/photo.jpg';
  const signatureUrl = 'https://example.test/pod/signature.svg';

  await request(app)
    .post(`/api/rider/jobs/${job.id}/deliver`)
    .set(auth(rider))
    .send({ otpCode: '4321', photoUrl, signatureUrl, note: 'Left with the watchman' })
    .expect(200);

  const stored = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(stored.photoUrl, photoUrl);
  assert.equal(stored.signatureUrl, signatureUrl);
  assert.equal(stored.deliveryNote, 'Left with the watchman');
});

test('rider app · proof is optional, because the OTP is the delivery', async () => {
  await resetDb();
  const { rider, job } = await seedAssignedJob();

  await request(app).post(`/api/rider/jobs/${job.id}/pickup`).set(auth(rider)).expect(200);

  // A refused camera permission, a dead connection to storage, or a rider in a
  // basement must never be what makes an order undeliverable. No photo, no
  // signature, still delivered.
  await request(app)
    .post(`/api/rider/jobs/${job.id}/deliver`)
    .set(auth(rider))
    .send({ otpCode: '4321' })
    .expect(200);

  const stored = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
  assert.equal(stored.photoUrl, null);
  assert.equal(stored.signatureUrl, null);
});

test('rider app · picking up before the shop is READY explains itself', async () => {
  await resetDb();
  const { rider, job, order } = await seedAssignedJob();

  await prisma.consumerOrder.update({ where: { id: order.id }, data: { status: 'PREPARING' } });

  const res = await request(app).post(`/api/rider/jobs/${job.id}/pickup`).set(auth(rider)).expect(409);

  // The detail screen reads `error.body.orderStatus` to say *which* state the
  // shop is in, rather than showing a bare "conflict".
  assert.equal(res.body.orderStatus, 'PREPARING');
});

test('rider app · going off shift mid-delivery is refused, and the screen says why', async () => {
  await resetDb();
  const { rider, job } = await seedAssignedJob();

  await request(app).post(`/api/rider/jobs/${job.id}/pickup`).set(auth(rider)).expect(200);

  // A 409, which `session.js` deliberately does not treat as the toggle having
  // moved — the flag is only ever set from a response that succeeded.
  await request(app).post('/api/rider/shift').set(auth(rider)).send({ isOnShift: false }).expect(409);

  const me = await request(app).get('/api/auth/me').set(auth(rider)).expect(200);
  assert.equal(me.body.user.isOnShift, true, 'the shift really did stay on');
});

test('rider app · coming on shift reports how many jobs it picked up', async () => {
  await resetDb();
  const { industry } = await seedBaseline();

  const shop = await createShop({ industryId: industry.id, latitude: 12.9716, longitude: 77.5946 });
  const rider = await createRider({ lastLat: 12.9718, lastLng: 77.5948, isOnShift: false });

  const customer = await createCustomer();
  const address = await createAddress({ customerId: customer.id, latitude: 12.9726, longitude: 77.5956 });
  const product = await createProduct({ industryId: industry.id, ownerId: shop.id });
  await stockShop({ shopId: shop.id, productId: product.id });

  const order = await prisma.consumerOrder.create({
    data: {
      orderNumber: `RM-C-${Date.now()}-w`,
      customerId: customer.id,
      industryId: industry.id,
      shopId: shop.id,
      addressId: address.id,
      status: 'READY',
      subtotal: '100.00',
      taxAmount: '0.00',
      deliveryFee: '0.00',
      discountAmount: '0.00',
      grandTotal: '100.00'
    }
  });

  // The job nobody could take: READY with no rider on shift.
  await prisma.deliveryJob.create({
    data: {
      type: 'LAST_MILE',
      status: 'UNASSIGNED',
      consumerOrderId: order.id,
      pickupLat: shop.latitude,
      pickupLng: shop.longitude,
      dropLat: address.latitude,
      dropLng: address.longitude,
      otpCode: '1111'
    }
  });

  const res = await request(app).post('/api/rider/shift').set(auth(rider)).send({ isOnShift: true }).expect(200);

  // The Shift screen alerts on this. Silently landing deliveries in a list
  // nobody is looking at is how the first one gets missed.
  assert.equal(res.body.isOnShift, true);
  assert.equal(res.body.jobsAssigned, 1);
});

test('rider app · earnings gives the screen its three questions and the rates', async () => {
  await resetDb();
  const { rider, job } = await seedAssignedJob();

  await request(app).post(`/api/rider/jobs/${job.id}/pickup`).set(auth(rider)).expect(200);
  await request(app)
    .post(`/api/rider/jobs/${job.id}/deliver`)
    .set(auth(rider))
    .send({ otpCode: '4321' })
    .expect(200);

  const res = await request(app).get('/api/rider/earnings').set(auth(rider)).expect(200);

  assert.equal(res.body.today.deliveries, 1);
  assert.equal(res.body.today.deadRuns, 0);
  assert.equal(typeof res.body.today.earned, 'string');

  assert.equal(res.body.pending.jobCount, 1);
  assert.equal(typeof res.body.pending.total, 'string');

  assert.ok(Array.isArray(res.body.settlements));

  // Shown on purpose, unlike `commission_percent`: this is the rider's own pay.
  assert.equal(typeof res.body.rates.baseFee, 'string');
  assert.equal(typeof res.body.rates.perKmFee, 'string');
  assert.equal(typeof res.body.rates.freeKm, 'number');
});

test('rider app · a shop’s own boy sees his earnings like anybody else', async () => {
  await resetDb();
  const { rider } = await seedAssignedJob({ employerShopId: 'SELF' });

  // ⚠️ **REVERSED 2026-08-09.** This endpoint used to answer 403
  // `EMPLOYED_BY_SHOP` for a shop's employee, and the app hid the tab, because
  // RoadMate paid him nothing and a screen of zeroes reads as "we owe you
  // nothing this week". The client's answer is that the platform pays every
  // rider — so refusing him this screen would now hide money he is owed.
  const res = await request(app).get('/api/rider/earnings').set(auth(rider)).expect(200);

  assert.ok(res.body.rates, 'a rider is entitled to know how his own pay is worked out');
  assert.equal(res.body.reason, undefined);
});

test('rider app · cash in hand, and handing it in', async () => {
  await resetDb();
  const { rider, job } = await seedAssignedJob();

  await request(app).post(`/api/rider/jobs/${job.id}/pickup`).set(auth(rider)).expect(200);
  await request(app)
    .post(`/api/rider/jobs/${job.id}/deliver`)
    .set(auth(rider))
    .send({ otpCode: '4321' })
    .expect(200);

  const held = await request(app).get('/api/rider/remittance').set(auth(rider)).expect(200);
  assert.equal(held.body.count, 1);
  assert.equal(held.body.totalHeld, '250.00');
  // The collections list on the Cash screen.
  assert.equal(typeof held.body.payments[0].consumerOrderId, 'number');
  assert.equal(held.body.payments[0].amount, '250.00');
  assert.ok(held.body.payments[0].collectedAt);

  const remitted = await request(app).post('/api/rider/remittance').set(auth(rider)).expect(200);
  assert.equal(remitted.body.count, 1);
  assert.equal(remitted.body.totalRemitted, '250.00');

  // A double tap. The claim re-asserts `cashRemittedAt: null`, so the second
  // one finds nothing — the screen's confirm dialog is belt to that braces.
  const again = await request(app).post('/api/rider/remittance').set(auth(rider)).expect(200);
  assert.equal(again.body.count, 0);
});

test('rider app · a field executive is not a rider', async () => {
  await resetDb();
  await seedBaseline();

  const fieldExec = await prisma.user.create({
    data: {
      email: `listing-${Date.now()}@test.roadmate`,
      password: (await import('bcryptjs')).default.hashSync('test1234', 4),
      name: 'Field Executive',
      role: 'EXECUTIVE',
      executiveType: 'LISTING',
      isActive: true
    }
  });

  // `executiveType` is what the door reads. Without it on the session payload
  // this account would look identical to a delivery partner and be signed in to
  // a job list that stays empty forever (HANDOFF §4's known gap).
  const me = await request(app).get('/api/auth/me').set(auth(fieldExec)).expect(200);
  assert.equal(me.body.user.executiveType, 'LISTING');

  // And the API agrees: every rider route is closed to them.
  await request(app).get('/api/rider/jobs').set(auth(fieldExec)).expect(403);
});

test.after(async () => {
  await disconnect();
});
