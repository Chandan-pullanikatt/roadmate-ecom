// File storage — the signed-upload seam (2026-08-09).
//
// Cloudinary credentials landed on 2026-08-08 and unblocked the two flows every
// earlier phase shipped around: the rider's proof-of-delivery photo/signature
// and the customer's prescription upload. Neither endpoint changed — both have
// always taken a **URL** (PLAN §6) — so what is worth pinning is not an endpoint
// shape but four rules that are easy to break silently later:
//
//   1. **The secret never leaves the server.** What the app receives is a
//      signature over a fixed set of parameters. This file asserts what is in
//      that set, and that the secret is not.
//   2. **A prescription is `authenticated`, always.** It is a medical record.
//      The upload type is inside the signed parameters, so an app cannot widen
//      it — and this test is what fails if somebody "simplifies" the kind table.
//   3. **Audience is enforced server-side.** A customer cannot sign a
//      proof-of-delivery photo; a rider cannot sign a prescription. The audience
//      comes from the route, never from the request body.
//   4. **A URL we did not issue must not be storable.** With credentials
//      present, `isOurAsset` is what stops an arbitrary link being recorded as
//      evidence of a delivery, or as a prescription. Without credentials it
//      passes anything — the same stub discipline as `razorpay.js` and `sms.js`,
//      and the reason every other test in this suite can post `example.com`.
//
// ⚠️ **No test here makes a network call.** Signing and URL checking are pure.
// The Admin API helpers (`listByTag` / `deleteAssets`) are only reachable from
// `npm run prune:uploads`, and they short-circuit without credentials.
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, customerTokenFor, disconnect } from './helpers/db.js';
import { createRider, createCustomer } from './helpers/factories.js';
import { signUpload, isOurAsset, isLive, UPLOAD_KINDS, kindsFor } from '../src/lib/cloudinary.js';

const CLOUD = 'roadmate-test-cloud';
const KEY = '123456789012345';
const SECRET = 'test_secret_value';

/** Turn the library live for one test, then put the environment back. */
function withCredentials(fn) {
  const before = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET
  };
  process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  process.env.CLOUDINARY_API_KEY = KEY;
  process.env.CLOUDINARY_API_SECRET = SECRET;
  const restore = () => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  // ⚠️ A plain try/finally would restore the environment the moment an async
  // `fn` returned its promise — i.e. before the request it started had reached
  // the controller, which would then see no credentials.
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

let rider;
let riderToken;
let customer;
let customerToken;
let shopToken;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  const world = await seedBaseline();
  shopToken = tokenFor(world.shop);

  rider = await createRider({ lastLat: 12.9716, lastLng: 77.5946 });
  riderToken = tokenFor(rider);

  customer = await createCustomer();
  customerToken = customerTokenFor(customer);
});

after(async () => {
  await disconnect();
});

const asRider = (path, body) =>
  request(app).post(path).set('Authorization', `Bearer ${riderToken}`).send(body);
const asCustomer = (path, body) =>
  request(app).post(path).set('Authorization', `Bearer ${customerToken}`).send(body);

// --- the library --------------------------------------------------------------

test('without credentials everything stubs out, exactly like razorpay and sms', () => {
  assert.equal(isLive(), false, '.env.test must stay credential-free — see .env.test.example');

  const signed = signUpload('POD_PHOTO');
  assert.equal(signed.live, false);
  assert.equal(signed.reason, 'NO_CREDENTIALS');
  assert.equal(signed.signature, undefined, 'nothing to sign with, so nothing is signed');

  // And the URL check passes anything, which is what keeps every other test in
  // this suite able to post an example.com URL.
  assert.equal(isOurAsset('https://example.com/whatever.jpg', 'PRESCRIPTION'), true);
});

test('a signature covers the folder, the type and the timestamp — and never the secret', () => {
  withCredentials(() => {
    const signed = signUpload('POD_PHOTO', { ownerRef: 'job42' });

    assert.equal(signed.live, true);
    assert.equal(signed.cloudName, CLOUD);
    assert.equal(signed.apiKey, KEY);
    assert.equal(signed.uploadUrl, `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);

    // The parameters the app must echo back, and nothing else signable.
    assert.deepEqual(Object.keys(signed.params).sort(), [
      'folder', 'public_id', 'tags', 'timestamp', 'type'
    ]);
    assert.equal(signed.params.folder, UPLOAD_KINDS.POD_PHOTO.folder);
    assert.ok(signed.params.public_id.startsWith('job42_'), 'traceable back to the job');

    // Recompute Cloudinary's own SHA-1 the way Cloudinary does.
    const canonical = Object.keys(signed.params)
      .sort()
      .map((k) => `${k}=${signed.params[k]}`)
      .join('&');
    assert.equal(
      signed.signature,
      crypto.createHash('sha1').update(`${canonical}${SECRET}`).digest('hex')
    );

    assert.ok(!JSON.stringify(signed).includes(SECRET), 'the secret must never be in the response');
  });
});

test('a prescription is an authenticated asset and a POD photo is not', () => {
  withCredentials(() => {
    // The whole difference between a medical record and a photo of a doorstep.
    assert.equal(signUpload('PRESCRIPTION').params.type, 'authenticated');
    assert.equal(signUpload('POD_PHOTO').params.type, 'upload');

    // And the tags are what the retention job sorts them by: POD photos expire,
    // prescriptions never do.
    assert.notEqual(UPLOAD_KINDS.PRESCRIPTION.tag, UPLOAD_KINDS.POD_PHOTO.tag);
  });
});

test('two signatures never name the same asset', () => {
  withCredentials(() => {
    const a = signUpload('POD_PHOTO', { ownerRef: 'job42' });
    const b = signUpload('POD_PHOTO', { ownerRef: 'job42' });
    assert.notEqual(a.params.public_id, b.params.public_id, 'a collision overwrites somebody’s proof');
  });
});

test('isOurAsset accepts our own asset and refuses everything else', () => {
  withCredentials(() => {
    const ok = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${UPLOAD_KINDS.POD_PHOTO.folder}/x.jpg`;
    assert.equal(isOurAsset(ok, 'POD_PHOTO'), true);

    // Somebody else's host, or somebody else's cloud.
    assert.equal(isOurAsset('https://evil.example/x.jpg', 'POD_PHOTO'), false);
    assert.equal(
      isOurAsset(`https://res.cloudinary.com/other-cloud/image/upload/v1/${UPLOAD_KINDS.POD_PHOTO.folder}/x.jpg`, 'POD_PHOTO'),
      false
    );
    // Right cloud, wrong folder — a prescription URL is not a delivery photo.
    assert.equal(
      isOurAsset(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/roadmate/other/x.jpg`, 'POD_PHOTO'),
      false
    );
    // Right folder, wrong delivery type: a prescription served publicly is the
    // exact failure `authenticated` exists to prevent.
    assert.equal(
      isOurAsset(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/${UPLOAD_KINDS.PRESCRIPTION.folder}/x.jpg`, 'PRESCRIPTION'),
      false
    );
    assert.equal(
      isOurAsset(`https://res.cloudinary.com/${CLOUD}/image/authenticated/v1/${UPLOAD_KINDS.PRESCRIPTION.folder}/x.jpg`, 'PRESCRIPTION'),
      true
    );
    assert.equal(isOurAsset('not a url', 'POD_PHOTO'), false);
  });
});

// --- the routes ---------------------------------------------------------------

test('each audience may only sign its own kinds', async () => {
  assert.deepEqual(kindsFor('customer'), ['PRESCRIPTION']);

  // A customer asking for a rider's kind is a 400 that names what is allowed,
  // and the audience comes from the route rather than the body.
  const wrong = await asCustomer('/api/customer/uploads/signature', { kind: 'POD_PHOTO' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.reason, 'UNKNOWN_KIND');
  assert.deepEqual(wrong.body.allowed, ['PRESCRIPTION']);

  const other = await asRider('/api/rider/uploads/signature', { kind: 'PRESCRIPTION' });
  assert.equal(other.status, 400);
  assert.equal(other.body.reason, 'UNKNOWN_KIND');
});

test('the rider route is riders only, and the customer route customers only', async () => {
  // A shop is staff and passes `protect`; `requireRider` is what stops it.
  const shop = await request(app)
    .post('/api/rider/uploads/signature')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ kind: 'POD_PHOTO' });
  assert.equal(shop.status, 403);

  // A staff token has no customer audience, so it cannot reach the other one.
  const staffOnCustomer = await request(app)
    .post('/api/customer/uploads/signature')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ kind: 'PRESCRIPTION' });
  assert.equal(staffOnCustomer.status, 401);

  assert.equal((await request(app).post('/api/rider/uploads/signature').send({})).status, 401);
});

test('without storage the answer is a 200 saying so, not an error', async () => {
  // The app renders no camera button from this. A 500 or a 404 would be an
  // outage; "this deployment has no storage" is a fact, and four phases shipped
  // around it deliberately.
  const res = await asRider('/api/rider/uploads/signature', { kind: 'POD_PHOTO' });
  assert.equal(res.status, 200);
  assert.equal(res.body.upload.live, false);
  assert.equal(res.body.upload.reason, 'NO_CREDENTIALS');
});

test('with storage the route hands back a usable signature', async () => {
  await withCredentials(async () => {
    const res = await asCustomer('/api/customer/uploads/signature', { kind: 'PRESCRIPTION' });
    assert.equal(res.status, 200);
    assert.equal(res.body.upload.live, true);
    assert.equal(res.body.upload.params.type, 'authenticated');
    assert.ok(res.body.upload.signature);
    assert.ok(!JSON.stringify(res.body).includes(SECRET));
  });
});
