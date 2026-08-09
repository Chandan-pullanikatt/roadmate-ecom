// Product photographs (PHASE A.2).
//
// The bug this file exists to keep buried: `createProduct` used to replace a
// blank `image` with a HARDCODED UNSPLASH STOCK PHOTO. A catalogue manager who
// left the field empty got a photograph of *somebody else's product* attached to
// theirs, shown to customers on the shelf as if it were the real item, with
// nothing anywhere reporting it. It is deleted, and the first test here is that
// it stays deleted.
//
// The rest is the signed-upload seam extended to a third kind. Two properties
// carry over from `uploads.test.js` and both matter more here than they look:
// PRODUCT_IMAGE is `type: upload` (public — it is the CDN-served shelf photo)
// and carries its OWN tag, because `pruneUploads` deletes by tag and the 90-day
// proof-of-delivery retention would otherwise empty the catalogue.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { resetDb, seedBaseline, tokenFor, prisma, disconnect } from './helpers/db.js';
import { createRider } from './helpers/factories.js';
import { UPLOAD_KINDS, kindsFor, signUpload, isOurAsset } from '../src/lib/cloudinary.js';

let world;
let masterToken;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  masterToken = tokenFor(world.master);
});

after(async () => {
  await disconnect();
});

// ── The stock photo is gone ────────────────────────────────────────────────

test('a product created without a photo has no photo, not somebody else’s', async () => {
  const res = await request(app)
    .post('/api/products/create')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ name: 'Toor Dal 1kg', sku: 'TD-1', price: 120, industryId: world.industry.id });

  assert.equal(res.status, 201);
  assert.equal(res.body.product.image, null);

  // Belt and braces: nothing anywhere may reintroduce a default.
  const stored = await prisma.product.findUnique({ where: { id: res.body.product.id } });
  assert.equal(stored.image, null);
  assert.ok(!/unsplash/i.test(String(stored.image)));
});

test('an empty-string photo clears rather than triggering a fallback', async () => {
  const res = await request(app)
    .post('/api/products/create')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ name: 'Rice 5kg', sku: 'R-5', price: 400, industryId: world.industry.id, image: '' });

  assert.equal(res.status, 201);
  assert.equal(res.body.product.image, null);
});

test('a photo can be removed from a product that had one', async () => {
  const created = await prisma.product.create({
    data: {
      name: 'Sugar 1kg', sku: 'S-1', price: 50,
      industryId: world.industry.id, ownerId: world.master.id,
      image: 'https://res.cloudinary.com/x/image/upload/roadmate/products/a.jpg'
    }
  });

  const res = await request(app)
    .put(`/api/products/${created.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ image: null });

  assert.equal(res.status, 200);
  assert.equal(res.body.product.image, null);
});

test('omitting the photo on an update leaves the existing one alone', async () => {
  const url = 'https://res.cloudinary.com/x/image/upload/roadmate/products/a.jpg';
  const created = await prisma.product.create({
    data: {
      name: 'Salt 1kg', sku: 'SA-1', price: 20,
      industryId: world.industry.id, ownerId: world.master.id, image: url
    }
  });

  const res = await request(app)
    .put(`/api/products/${created.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ price: 25 });

  assert.equal(res.status, 200);
  assert.equal(res.body.product.image, url);
});

// ── The upload kind's policy ───────────────────────────────────────────────

test('a product photo is public, and is NOT tagged as a proof-of-delivery photo', async () => {
  const policy = UPLOAD_KINDS.PRODUCT_IMAGE;

  // Public: this is the shelf photo, fetched by every phone that opens the app.
  assert.equal(policy.type, 'upload');

  // The sharp edge. `pruneUploads` deletes by tag, and a product photo carrying
  // `roadmate_pod` would be swept away by the 90-day retention run — emptying
  // the catalogue three months after launch, silently.
  assert.notEqual(policy.tag, UPLOAD_KINDS.POD_PHOTO.tag);
  assert.equal(policy.tag, 'roadmate_product');
});

test('only the catalogue audience may sign a product photo', async () => {
  assert.deepEqual(kindsFor('catalogue'), ['PRODUCT_IMAGE']);
  // A rider and a catalogue manager are both `User`s behind the same `protect`
  // guard, so this is the line that keeps them apart.
  assert.ok(!kindsFor('rider').includes('PRODUCT_IMAGE'));
  assert.ok(!kindsFor('customer').includes('PRODUCT_IMAGE'));
});

test('a rider cannot sign a catalogue photo', async () => {
  const rider = await createRider({ lastLat: 12.9, lastLng: 77.5 });

  const res = await request(app)
    .post('/api/products/uploads/signature')
    .set('Authorization', `Bearer ${tokenFor(rider)}`)
    .send({ kind: 'PRODUCT_IMAGE' });

  // Refused by the route's role guard, before the handler is ever reached.
  assert.equal(res.status, 403);
});

test('the catalogue route refuses a kind that is not its own', async () => {
  const res = await request(app)
    .post('/api/products/uploads/signature')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ kind: 'PRESCRIPTION' });

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'UNKNOWN_KIND');
});

test('without storage the answer is a 200 saying so, not an error', async () => {
  // `.env.test` is deliberately credential-free — that absence is what makes
  // every third-party library take its stub path under test.
  const res = await request(app)
    .post('/api/products/uploads/signature')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ kind: 'PRODUCT_IMAGE' });

  assert.equal(res.status, 200);
  assert.equal(res.body.upload.live, false);
  assert.equal(res.body.upload.reason, 'NO_CREDENTIALS');
});

test('with storage the route hands back a usable signature into the product folder', async () => {
  const saved = { ...process.env };
  process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  try {
    const res = await request(app)
      .post('/api/products/uploads/signature')
      .set('Authorization', `Bearer ${masterToken}`)
      .send({ kind: 'PRODUCT_IMAGE' });

    assert.equal(res.status, 200);
    assert.equal(res.body.upload.live, true);
    assert.equal(res.body.upload.params.folder, 'roadmate/products');
    assert.equal(res.body.upload.params.type, 'upload');
    assert.equal(res.body.upload.params.tags, 'roadmate_product');
    // The secret must never be in a response. It is enough to delete every
    // asset in the client's account.
    assert.ok(!JSON.stringify(res.body).includes('secret'));
  } finally {
    process.env = saved;
  }
});

// ── A URL we did not issue ─────────────────────────────────────────────────

test('a catalogue photo from somewhere else on the internet is refused', async () => {
  const saved = { ...process.env };
  process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  try {
    // The exact URL the deleted fallback used to write, which is the point.
    const res = await request(app)
      .post('/api/products/create')
      .set('Authorization', `Bearer ${masterToken}`)
      .send({
        name: 'Borrowed', sku: 'B-1', price: 99, industryId: world.industry.id,
        image: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341'
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.reason, 'NOT_OUR_ASSET');
    assert.equal(await prisma.product.count({ where: { name: 'Borrowed' } }), 0);
  } finally {
    process.env = saved;
  }
});

test('isOurAsset accepts a product photo in our own folder and refuses other kinds’', () => {
  const saved = { ...process.env };
  process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  try {
    assert.equal(
      isOurAsset('https://res.cloudinary.com/testcloud/image/upload/v1/roadmate/products/x.jpg', 'PRODUCT_IMAGE'),
      true
    );
    // A prescription URL is `authenticated` and lives elsewhere — passing one
    // here must not smuggle a medical record onto a public shelf.
    assert.equal(
      isOurAsset('https://res.cloudinary.com/testcloud/image/authenticated/v1/roadmate/prescriptions/x.jpg', 'PRODUCT_IMAGE'),
      false
    );
    assert.equal(isOurAsset('http://res.cloudinary.com/testcloud/image/upload/v1/roadmate/products/x.jpg', 'PRODUCT_IMAGE'), false);
  } finally {
    process.env = saved;
  }
});

test('two product signatures never name the same asset', () => {
  const saved = { ...process.env };
  process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  try {
    const a = signUpload('PRODUCT_IMAGE');
    const b = signUpload('PRODUCT_IMAGE');
    // A collision would silently overwrite another product's photograph.
    assert.notEqual(a.params.public_id, b.params.public_id);
  } finally {
    process.env = saved;
  }
});
