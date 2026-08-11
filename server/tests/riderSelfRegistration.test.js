// A rider joins by asking, and waits for somebody to say yes (2026-08-11).
//
// Before this, becoming a delivery partner meant somebody upstream typing you in
// — and choosing your password, which is why "what is this rider's password" had
// no good answer. A rider now applies from the Rider app with a phone number and
// an OTP, and **has no password at all**.
//
// The four things this file exists to pin, in rough order of how badly each one
// fails if it breaks:
//
//   1. A PENDING APPLICANT IS INERT. He cannot sign in, cannot use a staff route,
//      and — the one that would be a disaster — cannot be assigned an order. That
//      holds because of rules that already existed (`login`'s isActive check,
//      `protect`'s, `freeRidersNear`'s), and these tests are what stop a later
//      change quietly making an unapproved stranger assignable.
//
//   2. HE IS VISIBLE TO WHOEVER CAN APPROVE HIM. The near-miss failure of this
//      whole feature: `getPendingApprovals` matches `districtName` exactly and
//      used to also match `industryId`, so a rider — who has no industry, because
//      delivery has none — would have appeared in NO queue except MASTER's. It
//      passes every test written as MASTER and strands real applicants. Both
//      halves are pinned: the industry filter no longer applies to riders, and an
//      application to an uncovered district is refused at the door.
//
//   3. THE PHONE IS PROVEN BEFORE THE FORM. `register` reads the number out of the
//      signup ticket and there is no field in which to name another, so nobody can
//      file an application against somebody else's number.
//
//   4. NOTHING HERE CAN ESCALATE. `role`, `executiveType`, `isActive` and
//      `employerShopId` are hard-coded in the handler. This route is open to the
//      internet, so `role: 'MASTER'` in the body has to be inexpressible rather
//      than merely checked for.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import { createPartner, createShop, createRider } from './helpers/factories.js';
// `hasRiderCoverage` and not the private `freeRidersNear`: it reads the same
// `isActive` + `isOnShift` predicate over the same index, and it is the question
// that actually matters — whether this applicant makes an area deliverable.
import { hasRiderCoverage } from '../src/lib/shopRanking.js';
import { signRiderSignupToken } from '../src/lib/riderSignupToken.js';
import { isOurAsset, UPLOAD_KINDS } from '../src/lib/cloudinary.js';

const PHONE = '9812300011';
const STATE = 'Kerala';
const DISTRICT = 'Ernakulam';
const REGION = 'Kakkanad';

const LAT = 9.9816;
const LNG = 76.2999;

let world;
let district;
let regional;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();

  // A real desk in a real place. Everything about routing an application depends
  // on these rows existing and on the strings matching exactly.
  district = await createPartner({
    role: 'DISTRICT',
    name: 'Ernakulam District Partner',
    stateName: STATE,
    districtName: DISTRICT,
    industryId: world.industry.id
  });
  regional = await createPartner({
    role: 'REGIONAL',
    name: 'Kakkanad Regional Partner',
    stateName: STATE,
    districtName: DISTRICT,
    regionName: REGION,
    industryId: world.industry.id,
    parentId: district.id
  });
});

after(async () => {
  await disconnect();
});

const as = (t) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${t}`),
  post: (path, body) => request(app).post(path).set('Authorization', `Bearer ${t}`).send(body)
});

const CLOUD = 'roadmate-test-cloud';

/**
 * Turn the Cloudinary library live for one test, then put the environment back.
 * The same helper `uploads.test.js` uses, and the same async caveat: a plain
 * try/finally would restore the environment the instant an async `fn` handed back
 * its promise — before the request it started had reached the controller, which
 * would then see no credentials and skip the very check under test.
 */
function withCredentials(fn) {
  const before = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET
  };
  process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  process.env.CLOUDINARY_API_KEY = '123456789012345';
  process.env.CLOUDINARY_API_SECRET = 'test_secret_value';
  const restore = () => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

/** Ask for a code and return the plaintext the test-mode response exposes. */
async function requestOtp(phone = PHONE) {
  const res = await request(app).post('/api/rider/auth/otp/request').send({ phone });
  assert.equal(res.status, 200, `otp/request failed: ${JSON.stringify(res.body)}`);
  return res.body.code;
}

/** Prove the phone, and return whatever `verify` decided about it. */
async function verifyOtp(phone = PHONE) {
  const code = await requestOtp(phone);
  return request(app).post('/api/rider/auth/otp/verify').send({ phone, code });
}

/** A ticket for a phone nobody has an account for. */
async function ticketFor(phone = PHONE) {
  const res = await verifyOtp(phone);
  assert.equal(res.status, 200, `verify failed: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.outcome, 'NEW');
  return res.body.ticket;
}

/** The application every "happy path" test files. */
const APPLICATION = Object.freeze({
  name: 'Anoop Kumar',
  stateName: STATE,
  districtName: DISTRICT,
  regionName: REGION,
  vehicleType: 'Bike',
  vehicleNumber: 'KL07AB1234',
  licenceNumber: 'KL0720190001234',
  aadhaarNumber: '1234 5678 9012'
});

async function apply(overrides = {}, phone = PHONE) {
  const ticket = await ticketFor(phone);
  return request(app)
    .post('/api/rider/auth/register')
    .send({ ticket, ...APPLICATION, ...overrides });
}

// --- coverage: the list that makes an application findable --------------------

test('coverage is derived from active partner rows, so a picked district matches its approver exactly', async () => {
  const res = await request(app).get('/api/geo/coverage');

  assert.equal(res.status, 200);
  const kerala = res.body.states.find((s) => s.state === STATE);
  assert.ok(kerala, 'the state with a district partner is offered');

  const ernakulam = kerala.districts.find((d) => d.district === DISTRICT);
  assert.ok(ernakulam);
  // The strings are the partner's own, untouched — no title-casing, no trimming.
  // A transformation here is exactly how an applicant lands in nobody's queue.
  assert.deepEqual(ernakulam.regions, [REGION]);
});

test('coverage offers no district whose partner is unapproved — there would be nobody to review', async () => {
  await createPartner({
    role: 'DISTRICT',
    stateName: 'Karnataka',
    districtName: 'Bengaluru Urban',
    isActive: false
  });

  const res = await request(app).get('/api/geo/coverage');
  assert.equal(res.body.states.find((s) => s.state === 'Karnataka'), undefined);
});

test('coverage needs no token — it is the first call the registration screen makes', async () => {
  const res = await request(app).get('/api/geo/coverage');
  assert.equal(res.status, 200);
});

// --- the OTP door: four answers, and the branch is the point ------------------

test('a number nobody knows gets a signup ticket and the closed vehicle list', async () => {
  const res = await verifyOtp();

  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'NEW');
  assert.ok(res.body.ticket);
  assert.ok(res.body.vehicleTypes.includes('Bike'));
  // No account was created merely by proving a phone number. An OTP is not an
  // application.
  assert.equal(await prisma.user.count({ where: { phone: PHONE } }), 0);
});

test('otp/request says nothing about whether the number is known', async () => {
  const stranger = await request(app).post('/api/rider/auth/otp/request').send({ phone: PHONE });

  await createRider({ phone: '9812300022', isOnShift: false });
  const known = await request(app).post('/api/rider/auth/otp/request').send({ phone: '9812300022' });

  // Same status and same message: this endpoint must not be a directory of who
  // drives for RoadMate.
  assert.equal(stranger.status, known.status);
  assert.equal(stranger.body.message, known.body.message);
});

test('an approved rider signs in with the OTP and gets the ordinary staff token', async () => {
  await createRider({ name: 'Existing Rider', phone: PHONE, isOnShift: false });

  const res = await verifyOtp();
  assert.equal(res.body.outcome, 'SIGNED_IN');
  assert.ok(res.body.token);
  assert.equal(res.body.user.executiveType, 'DELIVERY');

  // The same token the seven dashboards and the Business app carry — it opens a
  // staff route with no special handling anywhere.
  const me = await as(res.body.token).get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.phone, PHONE);
});

test("a shop's own delivery boy can sign in with an OTP too — which is what removes the shop-typed password", async () => {
  const shop = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  await createRider({ name: "Shop's Boy", phone: PHONE, employerShopId: shop.id, isOnShift: false });

  const res = await verifyOtp();
  assert.equal(res.body.outcome, 'SIGNED_IN');
  assert.equal(res.body.user.employerShopId, shop.id);
});

test('a shop owner is told this is the wrong app, by role, rather than signed in', async () => {
  await prisma.user.update({ where: { id: world.shop.id }, data: { phone: PHONE } });

  const res = await verifyOtp();
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, 'WRONG_APP');
  assert.equal(res.body.role, 'SHOP');
  assert.equal(res.body.token, undefined);
});

test('a pending applicant is told he is pending, and which desk has it', async () => {
  assert.equal((await apply()).status, 201);

  const res = await verifyOtp();
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'PENDING');
  assert.equal(res.body.token, undefined);
  assert.equal(res.body.application.districtName, DISTRICT);
  assert.ok(res.body.application.appliedAt);
});

test('a released rider is told he was removed, not that he is still waiting', async () => {
  const shop = await createShop({ industryId: world.industry.id, latitude: LAT, longitude: LNG });
  const rider = await createRider({ phone: PHONE, employerShopId: shop.id, isOnShift: false });
  // What `updateShopRider` does when a shop takes somebody off its roster.
  await prisma.user.update({ where: { id: rider.id }, data: { isActive: false } });

  const res = await verifyOtp();
  assert.equal(res.body.outcome, 'DEACTIVATED');
  assert.equal(res.body.employerShop.id, shop.id);
});

test('a wrong code is refused, and a rider-flow code is not a customer-flow code', async () => {
  const bad = await request(app)
    .post('/api/rider/auth/otp/verify')
    .send({ phone: PHONE, code: '000000' });
  assert.equal(bad.status, 401);

  // The `purpose` column: a code minted for the Customer app must not open this
  // door, and vice versa, so the two flows cannot cancel each other's codes.
  const customerRes = await request(app)
    .post('/api/customer/auth/otp/request')
    .send({ phone: PHONE });
  const crossed = await request(app)
    .post('/api/rider/auth/otp/verify')
    .send({ phone: PHONE, code: customerRes.body.code });
  assert.equal(crossed.status, 401);
});

test('the Customer app refreshing a session does not kill a code a rider is typing', async () => {
  const riderCode = await requestOtp();
  // Exactly the collision `purpose` exists to prevent: this used to consume every
  // live code for the phone, rider flow included.
  await request(app).post('/api/customer/auth/otp/request').send({ phone: PHONE });

  const res = await request(app)
    .post('/api/rider/auth/otp/verify')
    .send({ phone: PHONE, code: riderCode });
  assert.equal(res.status, 200);
});

// --- registration ------------------------------------------------------------

test('an application creates an inactive platform rider with no usable password', async () => {
  const res = await apply();
  assert.equal(res.status, 201);
  assert.equal(res.body.outcome, 'PENDING');

  const rider = await prisma.user.findFirst({ where: { phone: PHONE } });
  assert.equal(rider.role, 'EXECUTIVE');
  assert.equal(rider.executiveType, 'DELIVERY');
  assert.equal(rider.isActive, false);
  assert.equal(rider.approvedAt, null);
  // A RoadMate delivery partner, in the platform pool — not any shop's employee.
  assert.equal(rider.employerShopId, null);
  // Applied rather than onboarded. This is what says so; no extra column needed.
  assert.equal(rider.parentId, null);
  assert.equal(rider.aadhaarNumber, '123456789012'); // normalised, digits only
  assert.equal(rider.vehicleNumber, 'KL07AB1234');

  // The password column holds a real bcrypt hash of randomness that no longer
  // exists, so password sign-in is arithmetically closed rather than merely unset.
  assert.match(rider.password, /^\$2[aby]?\$/);
  for (const guess of ['', 'password123', 'test1234', PHONE]) {
    const attempt = await request(app)
      .post('/api/auth/login')
      .send({ identifier: PHONE, password: guess });
    assert.notEqual(attempt.status, 200, `"${guess}" must not sign this rider in`);
  }
});

test('the phone comes from the ticket, so an application cannot be filed against a stranger', async () => {
  const ticket = await ticketFor('9812300033');

  const res = await request(app)
    .post('/api/rider/auth/register')
    // A phone in the body is not a field the handler reads — it is ignored.
    .send({ ticket, ...APPLICATION, phone: PHONE });

  assert.equal(res.status, 201);
  assert.equal(await prisma.user.count({ where: { phone: PHONE } }), 0);
  assert.equal(await prisma.user.count({ where: { phone: '9812300033' } }), 1);
});

test('no ticket, a junk ticket, and a staff token in its place are all refused', async () => {
  const staffToken = tokenFor(world.master);

  for (const ticket of [undefined, '', 'not-a-jwt', staffToken]) {
    const res = await request(app)
      .post('/api/rider/auth/register')
      .send({ ticket, ...APPLICATION });
    assert.equal(res.status, 401, `ticket ${JSON.stringify(ticket)} must not register anybody`);
    assert.equal(res.body.reason, 'TICKET_INVALID');
  }
  assert.equal(await prisma.user.count({ where: { role: 'EXECUTIVE' } }), 0);
});

test('an expired ticket is refused', async () => {
  // Signed with the real signer, then aged past its 15 minutes by the clock.
  const ticket = signRiderSignupToken(PHONE);
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60 * 1000;
  try {
    const res = await request(app)
      .post('/api/rider/auth/register')
      .send({ ticket, ...APPLICATION });
    assert.equal(res.status, 401);
  } finally {
    Date.now = realNow;
  }
});

test('a role in the body cannot escalate anything — the handler does not read one', async () => {
  const res = await apply({
    role: 'MASTER',
    executiveType: 'LISTING',
    isActive: true,
    employerShopId: world.shop.id,
    approvedAt: new Date().toISOString(),
    industryId: world.industry.id
  });
  assert.equal(res.status, 201);

  const rider = await prisma.user.findFirst({ where: { phone: PHONE } });
  assert.equal(rider.role, 'EXECUTIVE');
  assert.equal(rider.executiveType, 'DELIVERY');
  assert.equal(rider.isActive, false);
  assert.equal(rider.employerShopId, null);
  assert.equal(rider.approvedAt, null);
  assert.equal(rider.industryId, null);
});

test('an application to a district RoadMate does not cover is refused, not filed invisibly', async () => {
  const res = await apply({ districtName: 'Thrissur', regionName: null });

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'AREA_NOT_COVERED');
  assert.equal(await prisma.user.count({ where: { phone: PHONE } }), 0);
});

test('a district spelled differently from its partner is refused — the near-miss this guards', async () => {
  // Precisely the failure `geoController` exists to prevent: plausible, and
  // invisible to every approval queue if it were allowed through.
  const res = await apply({ districtName: 'Ernakulam District', regionName: null });
  assert.equal(res.body.reason, 'AREA_NOT_COVERED');
});

test('a region is optional, but a named one must be a real regional partner', async () => {
  const blank = await apply({ regionName: null });
  assert.equal(blank.status, 201);

  const wrong = await apply({ regionName: 'Nowhere' }, '9812300044');
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.reason, 'REGION_NOT_COVERED');
});

test('the area is mandatory', async () => {
  for (const overrides of [{ stateName: null }, { districtName: null }]) {
    const res = await apply({ ...overrides, regionName: null });
    assert.equal(res.status, 400);
    assert.equal(res.body.reason, 'AREA_REQUIRED');
  }
});

test('a motorised vehicle needs a plate and a licence; a bicycle needs neither', async () => {
  const noLicence = await apply({ licenceNumber: null });
  assert.equal(noLicence.body.reason, 'LICENCE_REQUIRED');

  const noPlate = await apply({ vehicleNumber: null });
  assert.equal(noPlate.body.reason, 'VEHICLE_NUMBER_REQUIRED');

  const cycle = await apply({ vehicleType: 'Bicycle', vehicleNumber: null, licenceNumber: null });
  assert.equal(cycle.status, 201, JSON.stringify(cycle.body));
});

test('the vehicle list is closed, and Aadhaar is required and validated', async () => {
  const invented = await apply({ vehicleType: 'Helicopter' });
  assert.equal(invented.body.reason, 'VEHICLE_REQUIRED');

  for (const aadhaarNumber of [null, '1234', '12345678901a']) {
    const res = await apply({ aadhaarNumber });
    assert.equal(res.body.reason, 'AADHAAR_REQUIRED');
  }
});

test('a document URL that is not ours is refused rather than shown to an approver', async () => {
  // Credentials are required for this one: `isOurAsset` returns true for any URL
  // when the library has no account to compare against, which is the documented
  // stub discipline (`lib/cloudinary.js`) and is why the check must be exercised
  // with keys present or it is not being exercised at all.
  await withCredentials(async () => {
    const res = await apply({ licenceDocUrl: 'https://evil.example.com/not-a-licence.png' });

    assert.equal(res.status, 400);
    assert.equal(res.body.reason, 'NOT_OUR_ASSET');
    assert.equal(res.body.field, 'licenceDocUrl');
    assert.equal(await prisma.user.count({ where: { phone: PHONE } }), 0);
  });
});

test('a document uploaded through RoadMate is stored for the approver to look at', async () => {
  await withCredentials(async () => {
    // The shape `signUpload('RIDER_DOC')` authorises: our cloud, `authenticated`
    // type (an identity document is never a public asset), our folder.
    const url =
      `https://res.cloudinary.com/${CLOUD}/image/authenticated/v1/` +
      `${UPLOAD_KINDS.RIDER_DOC.folder}/licence-abc.jpg`;
    assert.equal(isOurAsset(url, 'RIDER_DOC'), true, 'the fixture URL must be a valid one');

    const res = await apply({ licenceDocUrl: url, aadhaarDocUrl: url });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const seenByApprover = await as(tokenFor(district)).get('/api/partners/pending');
    const mine = seenByApprover.body.approvals.find((a) => a.phone === PHONE);
    assert.equal(mine.licenceDocUrl, url);
    assert.equal(mine.aadhaarDocUrl, url);
  });
});

test('documents are optional, because a deployment without file storage must still take applications', async () => {
  const res = await apply({ licenceDocUrl: null, aadhaarDocUrl: null });
  assert.equal(res.status, 201);
});

test('a number that already has an account cannot register a second one', async () => {
  await createRider({ phone: PHONE, isOnShift: false });

  // The ticket is minted by hand: `verifyOtp` would have answered SIGNED_IN and
  // never handed one out. This is the fifteen-minute race — a shop hiring this
  // number while the form was open.
  const res = await request(app)
    .post('/api/rider/auth/register')
    .send({ ticket: signRiderSignupToken(PHONE), ...APPLICATION });

  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'PHONE_TAKEN');
});

// --- a pending applicant is inert --------------------------------------------

test('a pending applicant cannot sign in and cannot be assigned an order', async () => {
  assert.equal((await apply()).status, 201);
  const rider = await prisma.user.findFirst({ where: { phone: PHONE } });

  // Even put on shift and given a live position — the two things that make a
  // rider assignable — `isActive: false` keeps him out of the pool entirely.
  await prisma.user.update({
    where: { id: rider.id },
    data: { isOnShift: true, lastLat: LAT, lastLng: LNG, lastLocationAt: new Date() }
  });

  assert.equal(
    await hasRiderCoverage(LAT, LNG, world.industry.id),
    false,
    'an unapproved applicant must never count as delivery coverage, let alone be offered an order'
  );

  // And a staff token minted for him — which no endpoint hands out, but a leaked
  // secret would — is refused by `protect` on the way in.
  const res = await as(tokenFor(rider)).get('/api/rider/jobs');
  assert.equal(res.status, 403);
});

// --- who can see, and approve, the application -------------------------------

test('the district desk sees the application even though a rider has no industry', async () => {
  assert.equal((await apply()).status, 201);

  const res = await as(tokenFor(district)).get('/api/partners/pending');
  assert.equal(res.status, 200);

  const mine = res.body.approvals.find((a) => a.phone === PHONE);
  assert.ok(mine, 'a rider with a NULL industryId must not be invisible to his district');
  // The queue is worth reading: the documents and the vehicle are there, so
  // "approve" is a decision rather than a rubber stamp.
  assert.equal(mine.vehicleType, 'Bike');
  assert.equal(mine.licenceNumber, APPLICATION.licenceNumber);
  assert.equal(mine.aadhaarNumber, '123456789012');
  assert.equal(mine.parentId, null); // applied, not onboarded
});

test('the regional desk sees an application that named its region', async () => {
  assert.equal((await apply()).status, 201);

  const res = await as(tokenFor(regional)).get('/api/partners/pending');
  assert.ok(res.body.approvals.find((a) => a.phone === PHONE));
});

test('the approvals queue never returns a password hash', async () => {
  assert.equal((await apply()).status, 201);

  for (const desk of [district, regional, world.master]) {
    const res = await as(tokenFor(desk)).get('/api/partners/pending');
    for (const row of res.body.approvals) {
      assert.equal(row.password, undefined, `${desk.role} was sent a password hash`);
    }
  }
});

test('a district partner in another district does not see the application', async () => {
  assert.equal((await apply()).status, 201);

  const elsewhere = await createPartner({
    role: 'DISTRICT',
    stateName: STATE,
    districtName: 'Thrissur',
    industryId: world.industry.id
  });

  const res = await as(tokenFor(elsewhere)).get('/api/partners/pending');
  assert.equal(res.body.approvals.find((a) => a.phone === PHONE), undefined);
});

test('approving the application is what lets the rider in, and he stays visible afterwards', async () => {
  assert.equal((await apply()).status, 201);
  const rider = await prisma.user.findFirst({ where: { phone: PHONE } });

  // Sign-in is refused right up to the moment of approval.
  assert.equal((await verifyOtp()).body.outcome, 'PENDING');

  const approve = await as(tokenFor(district)).post(`/api/partners/${rider.id}/approve`);
  assert.equal(approve.status, 200);

  const after = await verifyOtp();
  assert.equal(after.body.outcome, 'SIGNED_IN');
  assert.ok(after.body.token);

  const approved = await prisma.user.findUnique({ where: { id: rider.id } });
  assert.equal(approved.isActive, true);
  assert.ok(approved.approvedAt, 'the trial/approval timestamp is stamped as for any partner');

  // Approved and then gone from his own district's partner list would read as the
  // approval having failed — the same industry filter, in the other query.
  const active = await as(tokenFor(district)).get('/api/partners/active');
  assert.ok(active.body.partners.find((p) => p.phone === PHONE));
});

test('an approved self-registered rider joins the platform pool and is assignable', async () => {
  assert.equal((await apply()).status, 201);
  const rider = await prisma.user.findFirst({ where: { phone: PHONE } });
  await as(tokenFor(district)).post(`/api/partners/${rider.id}/approve`);

  await prisma.user.update({
    where: { id: rider.id },
    data: { isOnShift: true, lastLat: LAT, lastLng: LNG, lastLocationAt: new Date() }
  });

  assert.equal(
    await hasRiderCoverage(LAT, LNG, world.industry.id),
    true,
    'an approved rider is an ordinary platform rider and makes his area deliverable'
  );
});

test('rejecting the application removes it, and the number can apply again', async () => {
  assert.equal((await apply()).status, 201);
  const rider = await prisma.user.findFirst({ where: { phone: PHONE } });

  const reject = await as(tokenFor(district)).post(`/api/partners/${rider.id}/reject`);
  assert.equal(reject.status, 200);
  assert.equal(await prisma.user.count({ where: { phone: PHONE } }), 0);

  // Somebody who fixes a typo in their licence number must be able to reapply.
  assert.equal((await apply()).status, 201);
});

// --- the document upload signature -------------------------------------------

test('the document signature route needs a ticket, and offers exactly one kind', async () => {
  const noTicket = await request(app)
    .post('/api/rider/auth/uploads/signature')
    .send({ kind: 'RIDER_DOC' });
  assert.equal(noTicket.status, 401);

  const ticket = await ticketFor();

  // A ticket must not reach any other audience's kinds — a proof-of-delivery
  // photo against a stranger's job least of all.
  for (const kind of ['POD_PHOTO', 'PRESCRIPTION', 'PRODUCT_IMAGE', 'BANNER_IMAGE']) {
    const res = await request(app).post('/api/rider/auth/uploads/signature').send({ ticket, kind });
    assert.equal(res.status, 400, `a signup ticket must not sign ${kind}`);
    assert.equal(res.body.reason, 'UNKNOWN_KIND');
  }

  // Without Cloudinary credentials this answers `live: false` rather than
  // failing — the app hides the camera instead of offering one that dies.
  const ok = await request(app)
    .post('/api/rider/auth/uploads/signature')
    .send({ ticket, kind: 'RIDER_DOC' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.upload.kind, 'RIDER_DOC');
});
