// The storefront — the two taxonomy rails, the composed banner, and the two
// facts a shop card states (2026-08-10).
//
// This exists because four things shipped in earlier phases had **no way to be
// used**, which is a different bug from being broken and is invisible to every
// test that only asks whether an endpoint answers:
//
//   • `Industry.iconUrl` and `Category.iconUrl` — in the schema since Phase 0,
//     with no endpoint and no screen able to write to either. Two dead columns
//     describing a feature nobody could switch on.
//   • `Category` — no customer endpoint at all, so the design's category row was
//     unbuildable.
//   • `Banner.imageUrl` — required, so no banner could exist until somebody
//     opened a design tool. The model, the API and the Master screen had all
//     shipped in PHASE B and had never held a row.
//   • The shop card's ETA and free-delivery promise — neither was on the
//     serviceability response, so the design's list could not be built either.
//
// The properties pinned below, and why each one is worth a test:
//
//   1. **An unknown theme is refused, and the whitelist matches the design
//      system.** `Banner.theme` is a key into `packages/ui/src/tokens.js`, and
//      the two lists are one thing in two files. A silent default would render a
//      typo as the house yellow, which looks like "the colour didn't take" —
//      exactly the kind of failure nobody reports.
//   2. **An image is optional and a title is not.** The reverse of what the model
//      used to say.
//   3. **Industries cannot be created or deleted over HTTP**, only reordered and
//      restyled. An industry owns products, shops, orders and its fulfilment
//      branch; a web form must not be able to make one without any of that.
//   4. **A category with products refuses to be deleted.** `Product.categoryId`
//      is nullable, so Postgres would let the delete through and quietly null out
//      every product in it — not a deletion anybody asked for.
//   5. **The card's ETA is the same number placement promises.** Two formulas
//      would be the platform contradicting itself two taps apart.
//   6. **An unset free-delivery threshold is null, not 0.** "Free delivery above
//      ₹0" reads as "delivery is free", which is a claim nobody made.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import {
  resetDb, seedBaseline, tokenFor, customerTokenFor, prisma, disconnect
} from './helpers/db.js';
import {
  createCustomer, createShop, createRider, createProduct, stockShop, createIndustry
} from './helpers/factories.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BANNER_THEMES } from '../src/controllers/merchandisingController.js';
import { UPLOAD_KINDS, kindsFor } from '../src/lib/cloudinary.js';
import { etaMinutesForShops, promisedEtaMinutes } from '../src/lib/eta.js';

const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const ahead = (d) => new Date(Date.now() + d * DAY).toISOString();

let world;
let masterToken;
let customerToken;

before(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  world = await seedBaseline();
  masterToken = tokenFor(world.master);
  customerToken = customerTokenFor(await createCustomer());
});

after(async () => {
  await disconnect();
});

const asMaster = (req) => req.set('Authorization', `Bearer ${masterToken}`);
const asCustomer = (req) => req.set('Authorization', `Bearer ${customerToken}`);

// ---------------------------------------------------------------------------
// 1. The banner is a composed card
// ---------------------------------------------------------------------------

const banner = (extra = {}) => ({
  title: 'Get 20% OFF on Auto Essentials',
  validFrom: ago(1),
  validTo: ahead(10),
  ...extra
});

test('a banner needs no image — the card is composed, not a JPEG', async () => {
  const res = await asMaster(request(app).post('/api/master/banners')).send(
    banner({ subtitle: 'Shop premium products', theme: 'sky', ctaLabel: 'Order Now' })
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.banner.imageUrl, null);
  assert.equal(res.body.banner.theme, 'sky');
  assert.equal(res.body.banner.ctaLabel, 'Order Now');
  assert.equal(res.body.banner.phase, 'LIVE');
});

test('a banner still needs a title', async () => {
  const res = await asMaster(request(app).post('/api/master/banners')).send(
    banner({ title: '   ' })
  );
  assert.equal(res.status, 400);
});

test('an unknown theme is refused rather than silently defaulted', async () => {
  const res = await asMaster(request(app).post('/api/master/banners')).send(
    banner({ theme: 'neon-pink' })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'UNKNOWN_THEME');
});

test('the theme whitelist and the design system are the same list', () => {
  // One thing in two files: the server refuses the key and `packages/ui` paints
  // it. A key on one side only is either a banner the app renders unstyled or a
  // palette nobody can choose.
  //
  // Read as **text**, not imported. `server/` is deliberately outside the npm
  // workspaces (HANDOFF §2), and `@roadmate/ui` is a React Native package whose
  // entry point pulls in `react-native` — importing it here would drag the whole
  // mobile runtime into a Node test to read six object keys.
  const tokens = readFileSync(
    fileURLToPath(new URL('../../packages/ui/src/tokens.js', import.meta.url)),
    'utf8'
  );
  const block = tokens.match(/export const bannerThemes = \{([\s\S]*?)^\};/m);
  assert.ok(block, 'bannerThemes still exists in the token file');

  const painted = [...block[1].matchAll(/^\s{2}([a-z]+):\s*\{/gm)].map((m) => m[1]);
  assert.deepEqual([...BANNER_THEMES].sort(), painted.sort());
});

test('a CTA longer than the button is refused', async () => {
  const res = await asMaster(request(app).post('/api/master/banners')).send(
    banner({ ctaLabel: 'Tap here to order everything right now' })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'CTA_TOO_LONG');
});

test('blanking the theme, CTA and image clears them rather than erroring', async () => {
  const created = await asMaster(request(app).post('/api/master/banners')).send(
    banner({ theme: 'mint', ctaLabel: 'Shop now' })
  );

  const res = await asMaster(request(app).patch(`/api/master/banners/${created.body.banner.id}`)).send({
    theme: '',
    ctaLabel: '',
    imageUrl: ''
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.banner.theme, null);
  assert.equal(res.body.banner.ctaLabel, null);
  assert.equal(res.body.banner.imageUrl, null);
});

test('the customer sees the theme and the CTA, because the app draws the card', async () => {
  await asMaster(request(app).post('/api/master/banners')).send(
    banner({ theme: 'lilac', ctaLabel: 'Order Now', subtitle: 'Sub' })
  );

  const res = await asCustomer(request(app).get('/api/customer/banners'));
  assert.equal(res.status, 200);
  assert.equal(res.body.banners.length, 1);
  assert.equal(res.body.banners[0].theme, 'lilac');
  assert.equal(res.body.banners[0].ctaLabel, 'Order Now');
  assert.equal(res.body.banners[0].imageUrl, null);
});

// ---------------------------------------------------------------------------
// 2. Industries: presentation only
// ---------------------------------------------------------------------------

test('an industry can be restyled and reordered but not created or deleted', async () => {
  // No route exists for either verb. Asserted as a fact rather than assumed,
  // because "there is no endpoint" is exactly the kind of thing a later
  // convenience PR adds without noticing what an industry owns.
  const created = await asMaster(request(app).post('/api/master/industries')).send({ name: 'New' });
  assert.equal(created.status, 404);

  const deleted = await asMaster(request(app).delete(`/api/master/industries/${world.industry.id}`));
  assert.equal(deleted.status, 404);
});

test('an industry patch takes artwork, order and visibility', async () => {
  const res = await asMaster(request(app).patch(`/api/master/industries/${world.industry.id}`)).send({
    sortOrder: 3,
    isActive: false
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.industry.sortOrder, 3);
  assert.equal(res.body.industry.isActive, false);
});

test('the rail is ordered by sortOrder, and ties fall back to name', async () => {
  // The compatibility property: every row at 0 — which is every row on a
  // platform that has never used this feature — still comes back alphabetically,
  // exactly as `/api/industries` behaved before the column existed.
  const beta = await createIndustry({ name: 'Beta' });
  const alpha = await createIndustry({ name: 'Alpha' });

  const before = await request(app).get('/api/industries');
  const names = before.body.industries.map((i) => i.name);
  assert.deepEqual([...names].sort(), names);

  await asMaster(request(app).patch(`/api/master/industries/${beta.id}`)).send({ sortOrder: -1 });

  const after = await request(app).get('/api/industries');
  assert.equal(after.body.industries[0].id, beta.id);
  assert.ok(after.body.industries.some((i) => i.id === alpha.id));
});

test('reordering is one write over the whole list', async () => {
  const second = await createIndustry({ name: 'Second' });
  const third = await createIndustry({ name: 'Third' });

  const res = await asMaster(request(app).put('/api/master/industries/order')).send({
    industryIds: [third.id, world.industry.id, second.id]
  });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.industries.map((i) => i.id),
    [third.id, world.industry.id, second.id]
  );
});

test('a duplicate in the order is refused, not silently de-duplicated', async () => {
  const res = await asMaster(request(app).put('/api/master/industries/order')).send({
    industryIds: [world.industry.id, world.industry.id]
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.reason, 'DUPLICATE_INDUSTRY');
});

test('only MASTER may touch the taxonomy', async () => {
  const shopToken = tokenFor(world.shop);
  const res = await request(app)
    .patch(`/api/master/industries/${world.industry.id}`)
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ sortOrder: 1 });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// 3. Categories
// ---------------------------------------------------------------------------

const postCategory = (body) => asMaster(request(app).post('/api/master/categories')).send(body);

test('a category is created under one industry, with a derived handle', async () => {
  const res = await postCategory({ name: 'Oil & Lubes', industryId: world.industry.id });

  assert.equal(res.status, 201);
  assert.equal(res.body.category.slug, 'oil-lubes');
  assert.equal(res.body.category.industryId, world.industry.id);
  assert.equal(res.body.category.iconUrl, null);
});

test('two categories cannot share a handle within one industry', async () => {
  await postCategory({ name: 'Oil & Lubes', industryId: world.industry.id });
  const res = await postCategory({ name: 'Oil  Lubes', industryId: world.industry.id });

  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'SLUG_TAKEN');
});

test('the same handle in a different industry is fine', async () => {
  const other = await createIndustry({ name: 'Other' });
  await postCategory({ name: 'Snacks', industryId: world.industry.id });
  const res = await postCategory({ name: 'Snacks', industryId: other.id });
  assert.equal(res.status, 201);
});

test('a category holding products refuses to be deleted', async () => {
  const created = await postCategory({ name: 'Snacks', industryId: world.industry.id });
  const categoryId = created.body.category.id;
  await createProduct({
    name: 'Crisps',
    industryId: world.industry.id,
    ownerId: world.master.id,
    categoryId
  });

  const res = await asMaster(request(app).delete(`/api/master/categories/${categoryId}`));

  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'CATEGORY_IN_USE');
  assert.equal(res.body.productCount, 1);

  // And the product is untouched — the whole point. A cascade-to-null here
  // would be an unrecoverable edit disguised as a delete.
  const product = await prisma.product.findFirst({ where: { name: 'Crisps' } });
  assert.equal(product.categoryId, categoryId);
});

test('an empty category deletes', async () => {
  const created = await postCategory({ name: 'Empty', industryId: world.industry.id });
  const res = await asMaster(request(app).delete(`/api/master/categories/${created.body.category.id}`));
  assert.equal(res.status, 200);
});

test('the customer category row is ordered and scoped to the industry', async () => {
  const other = await createIndustry({ name: 'Other' });
  await postCategory({ name: 'Beta', industryId: world.industry.id, sortOrder: 1 });
  await postCategory({ name: 'Alpha', industryId: world.industry.id, sortOrder: 0 });
  await postCategory({ name: 'Elsewhere', industryId: other.id });

  const res = await asCustomer(
    request(app).get('/api/customer/categories').query({ industryId: world.industry.id })
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categories.map((c) => c.name), ['Alpha', 'Beta']);
});

test('the category row carries no fabricated "All" entry', async () => {
  // "All" is the absence of a filter, not a category. A row for it would need a
  // fake id that every caller has to know to skip; the app draws it instead.
  await postCategory({ name: 'Real', industryId: world.industry.id });
  const res = await asCustomer(
    request(app).get('/api/customer/categories').query({ industryId: world.industry.id })
  );
  assert.equal(res.body.categories.length, 1);
  assert.ok(!res.body.categories.some((c) => /^all$/i.test(c.name)));
});

// ---------------------------------------------------------------------------
// 4. The taxonomy icon upload
// ---------------------------------------------------------------------------

test('TAXONOMY_ICON is a merchandising kind and no other audience can sign it', () => {
  assert.equal(UPLOAD_KINDS.TAXONOMY_ICON.audience, 'merchandising');
  assert.ok(kindsFor('merchandising').includes('TAXONOMY_ICON'));

  // The sharp edge: widening the rider or catalogue audience instead would hand
  // every rider on the platform the right to sign artwork for the home screen.
  for (const audience of ['rider', 'customer', 'catalogue']) {
    assert.ok(!kindsFor(audience).includes('TAXONOMY_ICON'), audience);
  }
});

test('a taxonomy icon has its own retention tag', () => {
  // `pruneUploads` deletes by tag. A taxonomy icon carrying `roadmate_pod` would
  // blank the home screen's rail 90 days after launch — a failure nobody would
  // connect back to a cron job.
  assert.notEqual(UPLOAD_KINDS.TAXONOMY_ICON.tag, UPLOAD_KINDS.POD_PHOTO.tag);
  assert.equal(UPLOAD_KINDS.TAXONOMY_ICON.tag, 'roadmate_taxonomy');
});

test('the signature route is MASTER-only', async () => {
  const shopToken = tokenFor(world.shop);
  const res = await request(app)
    .post('/api/master/taxonomy/uploads/signature')
    .set('Authorization', `Bearer ${shopToken}`)
    .send({ kind: 'TAXONOMY_ICON' });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// 5. What a shop card says
// ---------------------------------------------------------------------------

/** A serviceable world: a stocked shop and a rider on shift, both in range. */
async function serviceableWorld({ fulfilmentType = 'PICK_AND_DELIVER', prepTimeMin = null } = {}) {
  const industry = await createIndustry({ name: 'Cards', fulfilmentType });
  const shop = await createShop({
    industryId: industry.id,
    latitude: 12.9716,
    longitude: 77.5946,
    prepTimeMin
  });
  const product = await createProduct({
    name: 'Thing',
    industryId: industry.id,
    ownerId: world.master.id
  });
  await stockShop({ shopId: shop.id, productId: product.id, quantity: 10 });
  await createRider({ lastLat: 12.9716, lastLng: 77.5946 });
  return { industry, shop, product };
}

test('a shop card carries an ETA, and it is the number placement promises', async () => {
  const { industry, shop } = await serviceableWorld();

  const res = await asCustomer(
    request(app)
      .get('/api/customer/serviceable')
      .query({ lat: 12.9716, lng: 77.5946, industryId: industry.id })
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.serviceable, true);
  const card = res.body.shops.find((s) => s.id === shop.id);
  assert.ok(card, 'the shop is on the list');
  assert.ok(Number.isInteger(card.etaMin) && card.etaMin > 0);

  // The property that matters: one formula, two callers. A card that says 20
  // minutes above a confirmation that says 30 is the platform contradicting
  // itself two taps apart.
  const row = await prisma.user.findUnique({ where: { id: shop.id } });
  const atPlacement = await promisedEtaMinutes({
    fulfilmentType: 'PICK_AND_DELIVER',
    shop: row,
    dropLat: 12.9716,
    dropLng: 77.5946,
    industryId: industry.id
  });
  assert.equal(card.etaMin, atPlacement);
});

test('the batched ETA agrees with the per-shop one for a restaurant too', async () => {
  // The one term that is genuinely per shop is the kitchen's clock, and it is
  // the term the batched version reads from a row already in memory rather than
  // going back to the database. If the two ever diverge it will be here.
  const { industry, shop } = await serviceableWorld({
    fulfilmentType: 'COOK_AND_DELIVER',
    prepTimeMin: 22
  });
  const row = await prisma.user.findUnique({ where: { id: shop.id } });

  const batched = await etaMinutesForShops([row], {
    fulfilmentType: 'COOK_AND_DELIVER',
    dropLat: 12.98,
    dropLng: 77.60,
    industryId: industry.id
  });
  const single = await promisedEtaMinutes({
    fulfilmentType: 'COOK_AND_DELIVER',
    shop: row,
    dropLat: 12.98,
    dropLng: 77.60,
    industryId: industry.id
  });

  assert.equal(batched.get(row.id), single);
  assert.ok(single >= 22, 'the kitchen is in the number');
});

test('a membership promises no ETA — null, never zero', async () => {
  const { industry, shop } = await serviceableWorld({ fulfilmentType: 'NO_DELIVERY' });
  const row = await prisma.user.findUnique({ where: { id: shop.id } });

  const batched = await etaMinutesForShops([row], {
    fulfilmentType: 'NO_DELIVERY',
    dropLat: 12.9716,
    dropLng: 77.5946,
    industryId: industry.id
  });

  // "No ETA" and "an ETA of zero minutes" are different claims and only the
  // first is true. A 0 renders as "0 mins away".
  assert.equal(batched.get(row.id), null);
});

test('an unset free-delivery threshold is null, not 0', async () => {
  const { industry } = await serviceableWorld();

  const res = await asCustomer(
    request(app)
      .get('/api/customer/serviceable')
      .query({ lat: 12.9716, lng: 77.5946, industryId: industry.id })
  );

  // `free_delivery_threshold` defaults to 0 in `CONFIG_DEFAULTS` — meaning
  // nobody has decided. "Free delivery above ₹0" reads as "delivery is free".
  assert.equal(res.body.freeDeliveryAbove, null);
});

test('a set free-delivery threshold reaches the card as money', async () => {
  const { industry } = await serviceableWorld();
  await prisma.platformConfig.create({ data: { key: 'free_delivery_threshold', value: '199' } });

  const res = await asCustomer(
    request(app)
      .get('/api/customer/serviceable')
      .query({ lat: 12.9716, lng: 77.5946, industryId: industry.id })
  );

  assert.equal(res.body.freeDeliveryAbove, '199.00');
});
