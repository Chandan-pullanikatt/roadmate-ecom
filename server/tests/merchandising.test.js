// Banners and collections (PHASE B) — the merchandising surface.
//
// Neither existed in any form: no model, no endpoint, no screen. Ordering worked
// end to end and promoting did not exist at all, which is why the customer home
// screen was a catalogue sorted by distance.
//
// The properties worth pinning, and why each one is here:
//
//   • A BANNER SWITCHES ITSELF OFF. The window is applied in the query, so a
//     Diwali strip stops appearing the moment it expires with nothing having to
//     run. `phase` is derived from the clock, never stored.
//
//   • A BANNER OPENS ONE THING. Four nullable target columns can hold two at
//     once, and a banner that both opens a shop and applies a coupon has no
//     defined behaviour — the app would take whichever branch it tested first.
//
//   • A COLLECTION IS ORDERED, and the order is replaced as a whole. Add/remove/
//     reorder as three verbs makes "move this to the top" a sequence that can
//     half-fail and leave two products claiming position 3.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import {
  resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect
} from './helpers/db.js';
import { createCustomer, createProduct, createIndustry } from './helpers/factories.js';
import { UPLOAD_KINDS, kindsFor } from '../src/lib/cloudinary.js';

const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY);
const ahead = (d) => new Date(Date.now() + d * DAY);

const IMAGE = 'https://res.cloudinary.com/x/image/upload/roadmate/banners/a.jpg';

let world;
let masterToken;
let customerToken;
let productA;
let productB;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  masterToken = tokenFor(world.master);
  customerToken = customerTokenFor(await createCustomer());
  productA = await createProduct({ name: 'Dal', industryId: world.industry.id, ownerId: world.master.id });
  productB = await createProduct({ name: 'Rice', industryId: world.industry.id, ownerId: world.master.id });
});

after(async () => {
  await disconnect();
});

const banner = (extra = {}) => ({
  title: 'Diwali Sale',
  imageUrl: IMAGE,
  validFrom: ago(1).toISOString(),
  validTo: ahead(10).toISOString(),
  ...extra
});

const postBanner = (body, token = masterToken) =>
  request(app).post('/api/master/banners').set('Authorization', `Bearer ${token}`).send(body);

const postCollection = (body, token = masterToken) =>
  request(app).post('/api/master/collections').set('Authorization', `Bearer ${token}`).send(body);

// ═══ BANNERS ═══════════════════════════════════════════════════════════════

test('a banner can be created and comes back live', async () => {
  const res = await postBanner(banner());

  assert.equal(res.status, 201);
  assert.equal(res.body.banner.title, 'Diwali Sale');
  assert.equal(res.body.banner.phase, 'LIVE');
  assert.equal(res.body.banner.target.type, 'NONE');
});

test('phase is derived from the clock', async () => {
  await postBanner(banner({ title: 'Past', validFrom: ago(30).toISOString(), validTo: ago(1).toISOString() }));
  await postBanner(banner({ title: 'Future', validFrom: ahead(5).toISOString(), validTo: ahead(30).toISOString() }));
  await postBanner(banner({ title: 'Off', isActive: false }));
  await postBanner(banner({ title: 'Now' }));

  const res = await request(app)
    .get('/api/master/banners')
    .set('Authorization', `Bearer ${masterToken}`);

  const phase = Object.fromEntries(res.body.banners.map((b) => [b.title, b.phase]));
  assert.equal(phase.Past, 'EXPIRED');
  assert.equal(phase.Future, 'SCHEDULED');
  assert.equal(phase.Off, 'WITHDRAWN');
  assert.equal(phase.Now, 'LIVE');
});

test('a festival banner switches itself off — the customer stops seeing it', async () => {
  // The whole reason a banner is a model with a window rather than a hardcoded
  // array. Nothing has to run for this to happen.
  await postBanner(banner({ title: 'Diwali', validFrom: ago(30).toISOString(), validTo: ago(1).toISOString() }));
  await postBanner(banner({ title: 'Live one' }));

  const res = await request(app)
    .get('/api/customer/banners')
    .set('Authorization', `Bearer ${customerToken}`);

  assert.deepEqual(res.body.banners.map((b) => b.title), ['Live one']);
});

test('a banner opens one thing, never two', async () => {
  const coupon = await prisma.coupon.create({
    data: {
      code: 'FEST', title: 'Festive', discountType: 'FLAT', discountValue: 50,
      validFrom: ago(1), validTo: ahead(30)
    }
  });

  const res = await postBanner(banner({ targetShopId: world.shop.id, targetCouponId: coupon.id }));

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'MULTIPLE_TARGETS');
});

test('a target that does not exist is refused at the write', async () => {
  // In front of whoever is making the banner — not silently on a customer's tap
  // three weeks later.
  const res = await postBanner(banner({ targetProductId: 999999 }));

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'BAD_TARGET');
});

test('the target is one object, whatever column it is stored in', async () => {
  const res = await postBanner(banner({ targetProductId: productA.id }));

  assert.equal(res.status, 201);
  assert.deepEqual(res.body.banner.target, {
    type: 'PRODUCT', id: productA.id, label: 'Dal'
  });
});

test('changing the target clears the old one', async () => {
  const created = await postBanner(banner({ targetProductId: productA.id }));

  const moved = await request(app)
    .patch(`/api/master/banners/${created.body.banner.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ targetShopId: world.shop.id });

  assert.equal(moved.status, 200);
  assert.equal(moved.body.banner.target.type, 'SHOP');
  const row = await prisma.banner.findUnique({ where: { id: created.body.banner.id } });
  assert.equal(row.targetProductId, null);
});

test('a banner scoped to one industry is not on another’s home screen', async () => {
  const other = await createIndustry({ name: 'Pharmacy' });
  await postBanner(banner({ title: 'Grocery only', industryId: world.industry.id }));
  await postBanner(banner({ title: 'Pharmacy only', industryId: other.id }));
  await postBanner(banner({ title: 'Everywhere' }));

  const res = await request(app)
    .get('/api/customer/banners')
    .query({ industryId: world.industry.id })
    .set('Authorization', `Bearer ${customerToken}`);

  assert.deepEqual(res.body.banners.map((b) => b.title).sort(), ['Everywhere', 'Grocery only']);
});

test('banners come back in the editorial order', async () => {
  await postBanner(banner({ title: 'Third', sortOrder: 30 }));
  await postBanner(banner({ title: 'First', sortOrder: 10 }));
  await postBanner(banner({ title: 'Second', sortOrder: 20 }));

  const res = await request(app)
    .get('/api/customer/banners')
    .set('Authorization', `Bearer ${customerToken}`);

  assert.deepEqual(res.body.banners.map((b) => b.title), ['First', 'Second', 'Third']);
});

test('a banner window that ends before it starts is refused', async () => {
  const res = await postBanner(banner({ validFrom: ahead(10).toISOString(), validTo: ahead(2).toISOString() }));
  assert.equal(res.status, 400);
});

test('a banner image from somewhere else is refused', async () => {
  const saved = { ...process.env };
  process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  try {
    const res = await postBanner(banner({ imageUrl: 'https://example.com/a.jpg' }));
    assert.equal(res.status, 400);
    assert.equal(res.body.reason, 'NOT_OUR_ASSET');
  } finally {
    process.env = saved;
  }
});

test('banner artwork has its own retention tag and its own audience', async () => {
  // `pruneUploads` deletes by tag: banner artwork carrying `roadmate_pod` would
  // be swept away by the 90-day proof-of-delivery run.
  assert.equal(UPLOAD_KINDS.BANNER_IMAGE.tag, 'roadmate_banner');
  assert.notEqual(UPLOAD_KINDS.BANNER_IMAGE.tag, UPLOAD_KINDS.POD_PHOTO.tag);
  assert.notEqual(UPLOAD_KINDS.BANNER_IMAGE.tag, UPLOAD_KINDS.PRODUCT_IMAGE.tag);
  // A manufacturer signing a product photo must not also be able to put artwork
  // on every customer's home screen.
  assert.ok(!kindsFor('catalogue').includes('BANNER_IMAGE'));
  assert.deepEqual(kindsFor('merchandising'), ['BANNER_IMAGE']);
});

test('banners are MASTER only', async () => {
  const res = await postBanner(banner(), tokenFor(world.shop));
  assert.equal(res.status, 403);
});

test('a banner can be deleted outright — no order depends on one', async () => {
  const created = await postBanner(banner());
  const res = await request(app)
    .delete(`/api/master/banners/${created.body.banner.id}`)
    .set('Authorization', `Bearer ${masterToken}`);

  assert.equal(res.status, 200);
  assert.equal(await prisma.banner.count(), 0);
});

// ═══ COLLECTIONS ═══════════════════════════════════════════════════════════

test('a collection is created with a handle derived from its title', async () => {
  const res = await postCollection({ title: 'Items under ₹99' });

  assert.equal(res.status, 201);
  assert.equal(res.body.collection.slug, 'items-under-99');
  assert.equal(res.body.collection.productCount, 0);
});

test('a duplicate handle is a 409', async () => {
  await postCollection({ title: 'Bestsellers' });
  const res = await postCollection({ title: 'Bestsellers' });

  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'SLUG_TAKEN');
});

test('the item list is set as a whole, and position comes from the order given', async () => {
  const created = await postCollection({ title: 'Bestsellers' });

  const res = await request(app)
    .put(`/api/master/collections/${created.body.collection.id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productB.id, productA.id] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.collection.products.map((p) => p.name), ['Rice', 'Dal']);
  assert.deepEqual(res.body.collection.products.map((p) => p.position), [0, 1]);
});

test('reordering is one write, and leaves no stale positions behind', async () => {
  const created = await postCollection({ title: 'Bestsellers' });
  const id = created.body.collection.id;
  const put = (productIds) =>
    request(app)
      .put(`/api/master/collections/${id}/items`)
      .set('Authorization', `Bearer ${masterToken}`)
      .send({ productIds });

  await put([productA.id, productB.id]);
  const res = await put([productB.id, productA.id]);

  assert.deepEqual(res.body.collection.products.map((p) => p.name), ['Rice', 'Dal']);
  // Exactly two rows — the replace deleted rather than accumulated.
  assert.equal(await prisma.collectionItem.count({ where: { collectionId: id } }), 2);
});

test('emptying a collection is sending an empty list', async () => {
  const created = await postCollection({ title: 'Bestsellers' });
  const id = created.body.collection.id;
  await request(app)
    .put(`/api/master/collections/${id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productA.id] });

  const res = await request(app)
    .put(`/api/master/collections/${id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [] });

  assert.equal(res.status, 200);
  assert.equal(res.body.collection.productCount, 0);
});

test('the same product twice is refused rather than silently de-duplicated', async () => {
  const created = await postCollection({ title: 'Bestsellers' });

  const res = await request(app)
    .put(`/api/master/collections/${created.body.collection.id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productA.id, productA.id] });

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'DUPLICATE_PRODUCT');
});

test('a product that does not exist is refused, and nothing is written', async () => {
  const created = await postCollection({ title: 'Bestsellers' });
  const id = created.body.collection.id;
  await request(app)
    .put(`/api/master/collections/${id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productA.id] });

  const res = await request(app)
    .put(`/api/master/collections/${id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productB.id, 999999] });

  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'BAD_PRODUCT');
  // The old list survived — a rejected edit must not empty the collection.
  const rows = await prisma.collectionItem.findMany({ where: { collectionId: id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productId, productA.id);
});

test('a customer sees active, non-empty collections in order', async () => {
  const full = await postCollection({ title: 'Bestsellers', sortOrder: 10 });
  await request(app)
    .put(`/api/master/collections/${full.body.collection.id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productA.id] });

  // Empty: a heading with nothing under it. Hidden, not deactivated — it fills
  // up again the moment somebody adds a product back.
  await postCollection({ title: 'Empty one', sortOrder: 5 });

  const off = await postCollection({ title: 'Withdrawn', sortOrder: 1 });
  await request(app)
    .patch(`/api/master/collections/${off.body.collection.id}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ isActive: false });

  const res = await request(app)
    .get('/api/customer/collections')
    .set('Authorization', `Bearer ${customerToken}`);

  assert.deepEqual(res.body.collections.map((c) => c.title), ['Bestsellers']);
});

test('a shop’s own collection is not shown on another shop’s page', async () => {
  const mine = await postCollection({ title: 'Shop picks', shopId: world.shop.id });
  await request(app)
    .put(`/api/master/collections/${mine.body.collection.id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productA.id] });

  const platform = await postCollection({ title: 'Platform picks' });
  await request(app)
    .put(`/api/master/collections/${platform.body.collection.id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productB.id] });

  const withoutShop = await request(app)
    .get('/api/customer/collections')
    .set('Authorization', `Bearer ${customerToken}`);
  assert.deepEqual(withoutShop.body.collections.map((c) => c.title), ['Platform picks']);

  const withShop = await request(app)
    .get('/api/customer/collections')
    .query({ shopId: world.shop.id })
    .set('Authorization', `Bearer ${customerToken}`);
  assert.deepEqual(withShop.body.collections.map((c) => c.title).sort(), ['Platform picks', 'Shop picks']);
});

test('deleting a collection takes its items with it', async () => {
  const created = await postCollection({ title: 'Bestsellers' });
  const id = created.body.collection.id;
  await request(app)
    .put(`/api/master/collections/${id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productA.id, productB.id] });

  const res = await request(app)
    .delete(`/api/master/collections/${id}`)
    .set('Authorization', `Bearer ${masterToken}`);

  assert.equal(res.status, 200);
  assert.equal(await prisma.collectionItem.count(), 0);
});

test('collections are MASTER only', async () => {
  const res = await postCollection({ title: 'Nope' }, tokenFor(world.shop));
  assert.equal(res.status, 403);
});

test('a collection carries no money anywhere in its response', async () => {
  // It is a curation, not an offer. No discount, no commission, no settlement —
  // the product's own catalogue price rides along and nothing else.
  const created = await postCollection({ title: 'Bestsellers' });
  await request(app)
    .put(`/api/master/collections/${created.body.collection.id}/items`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ productIds: [productA.id] });

  const res = await request(app)
    .get('/api/customer/collections')
    .set('Authorization', `Bearer ${customerToken}`);

  const body = JSON.stringify(res.body);
  for (const word of ['discount', 'commission', 'settlement', 'payable']) {
    assert.ok(!body.toLowerCase().includes(word), `collection response mentions "${word}"`);
  }
});
