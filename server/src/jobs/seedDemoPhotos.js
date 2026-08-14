// Put a photograph on every demo product, shop and banner.
// `npm run demo:photos [-- --force | --dry-run | --credits | --only=<slug>
//                       | --products | --shops | --banners]`
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
//
// `demo:storefront` fixed an empty platform: categories, banners, collections,
// ratings, and real shops for all six industries. What it left is a catalogue of
// 49 products where **`image` is null on every single row**, so the Customer app
// draws a grey placeholder beside every name — on the shelf, in search, in the
// cart, and in the order the shop sees. A client scrolling that reads it as an
// app that cannot show pictures, which is the opposite of true: the upload seam
// works end to end, and nobody had ever run it for the demo data.
//
// So this is the missing half of `demo:storefront` and deliberately a *separate*
// script, because unlike its sibling it needs the network and the client's
// Cloudinary account, and it must be re-runnable on its own when a photo is
// wrong.
//
// ── WHAT IT DOES, AND THE ONE RULE IT KEEPS ───────────────────────────────────
//
// Three passes over three pinned lists — `productPhotos.js` (→ `Product.image`),
// `shopPhotos.js` (→ `User.coverImageUrl`) and `bannerPhotos.js` (→
// `Banner.imageUrl`). For each entry it fetches the pinned source picture,
// **uploads it into the client's own Cloudinary account** under that kind's
// folder, and writes the resulting `res.cloudinary.com` URL to every row of that
// name. The three differ only in table, column and upload kind, so they are rows
// in `PASSES` below rather than three copies of the same loop.
//
// ⚠️ The upload is not a formality, and skipping it to save a round trip would
// break the platform quietly. `isOurAsset` (`lib/cloudinary.js`) refuses any
// host but our own, and `updateProduct` runs it on every edit — so a product
// carrying a raw flickr or wikimedia URL would look fine on the shelf and then
// **400 with NOT_OUR_ASSET the first time anybody changed its price**, with the
// error pointing at the price rather than at the photo. Uploading first means
// what lands in the database is indistinguishable from a photo a catalogue
// manager uploaded through the Master dashboard, which is what it is pretending
// to be.
//
// ⚠️ **Without credentials this writes nothing at all.** Not the source URLs —
// that is precisely the forbidden state above, and a demo that half-works is
// worse than one that says what it needs. Every other third-party seam on this
// platform stubs out silently; this one refuses, because the artefact it would
// leave behind is a database full of URLs the API itself will not accept.
//
// ── RE-RUNNING ────────────────────────────────────────────────────────────────
//
// Idempotent, like every other demo script here. A product already holding one
// of our own Cloudinary assets is left alone; a product holding **anything else**
// is replaced, which is how the five `prisma/seed.js` rows still carrying the
// deleted backfill's `images.unsplash.com` URLs finally get fixed. `--force`
// re-uploads everything. The Cloudinary public id is the product slug, so a
// re-upload overwrites its own previous asset instead of adding a duplicate.
//
// `--only=<slug>` narrows the run to one entry, which is the case that actually
// comes up: a picture looks wrong on the shelf, you change its `source` in the
// catalogue, and you want that one re-fetched — not another 90 uploads to
// correct a single tile. It implies `--force`, because the row it is aiming at
// is by definition one that already has a photo. `--products` / `--shops` /
// `--banners` narrow it to one pass.
//
// Dev/demo only. It touches `Product.image`, `User.coverImageUrl` and
// `Banner.imageUrl` and nothing else — no order, no payment, no settlement.
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';
import { isLive, isOurAsset, signUpload, UPLOAD_KINDS } from '../lib/cloudinary.js';
import { PRODUCT_PHOTOS, creditLines } from './productPhotos.js';
import { SHOP_PHOTOS } from './shopPhotos.js';
import { BANNER_PHOTOS } from './bannerPhotos.js';

dotenv.config();

const UA = 'roadmate-demo-catalogue/1.0';

/**
 * The three things this seeds, described rather than branched on. Everything
 * below — upload, staleness, reporting — is identical for all of them; only the
 * table, the column and the upload kind differ, so they are data here instead of
 * an `if` repeated in five places.
 */
const PASSES = [
  {
    name: 'products',
    entries: PRODUCT_PHOTOS,
    kind: 'PRODUCT_IMAGE',
    label: (e) => e.product,
    // `Product.image` is the shelf photo.
    find: (name) => prisma.product.findMany({ where: { name }, select: { id: true, image: true } }),
    current: (row) => row.image,
    write: (ids, url) => prisma.product.updateMany({ where: { id: { in: ids } }, data: { image: url } }),
    missingHint: 'run `npm run demo:storefront` first'
  },
  {
    name: 'shops',
    entries: SHOP_PHOTOS,
    kind: 'SHOP_IMAGE',
    label: (e) => e.shop,
    // ⚠️ `coverImageUrl`, never `logoUrl` — see the header of `shopPhotos.js`.
    // A photograph of a shop like this one is a stand-in; a logo would be a
    // claim about this business's identity.
    find: (name) =>
      prisma.user.findMany({
        where: { role: 'SHOP', name },
        select: { id: true, coverImageUrl: true }
      }),
    current: (row) => row.coverImageUrl,
    write: (ids, url) => prisma.user.updateMany({ where: { id: { in: ids } }, data: { coverImageUrl: url } }),
    missingHint: 'run `npm run demo:geo` and `npm run demo:storefront` first'
  },
  {
    name: 'banners',
    entries: BANNER_PHOTOS,
    kind: 'BANNER_IMAGE',
    label: (e) => e.banner,
    // Keyed by title, the same key `seedDemoStorefront.js` uses to upsert them.
    find: (title) => prisma.banner.findMany({ where: { title }, select: { id: true, imageUrl: true } }),
    current: (row) => row.imageUrl,
    write: (ids, url) => prisma.banner.updateMany({ where: { id: { in: ids } }, data: { imageUrl: url } }),
    missingHint: 'run `npm run demo:storefront` first'
  }
];

/**
 * Fetch the pinned picture and hand the bytes to Cloudinary under a signature we
 * computed here.
 *
 * The bytes go through this process rather than passing Cloudinary the remote
 * URL to pull for itself. That costs one extra hop and buys the thing worth
 * having: if a source has rotted, this fails *here*, with the product or shop
 * name in the message, instead of Cloudinary storing a 404 page as a JPEG and
 * the demo showing a broken tile nobody can trace back.
 */
async function uploadOne({ slug, source }, kind) {
  const policy = UPLOAD_KINDS[kind];
  const signed = signUpload(kind, { publicId: slug });
  if (!signed.live) throw new Error(signed.reason);

  const res = await fetch(source, {
    headers: { 'User-Agent': UA, Accept: 'image/*' },
    signal: AbortSignal.timeout(45_000)
  });
  if (!res.ok) throw new Error(`source ${res.status}`);

  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`source is ${type || 'untyped'}, not an image`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 2_000) throw new Error(`source is ${bytes.length} bytes — not a photograph`);
  if (bytes.length > policy.maxBytes) {
    throw new Error(`source is ${(bytes.length / 1e6).toFixed(1)} MB, over the ${policy.maxBytes / 1e6} MB budget`);
  }

  const form = new FormData();
  // Exactly the signed parameters and nothing else. An extra one invalidates the
  // signature — Cloudinary re-hashes everything it is sent bar `file`,
  // `api_key` and `resource_type`.
  for (const [key, value] of Object.entries(signed.params)) form.append(key, String(value));
  form.append('api_key', signed.apiKey);
  form.append('signature', signed.signature);
  form.append('file', new Blob([bytes]), `${slug}.jpg`);

  const up = await fetch(signed.uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  const payload = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(`cloudinary ${up.status}: ${payload?.error?.message ?? 'unknown'}`);
  if (!payload.secure_url) throw new Error('cloudinary returned no secure_url');

  // Belt and braces: what we are about to store must satisfy the same guard the
  // API will apply to it on the next edit. If this ever fails, the folder or the
  // type in `UPLOAD_KINDS` has drifted from what `isOurAsset` expects, and it is
  // far better to hear about it now than from a client editing a price.
  if (!isOurAsset(payload.secure_url, kind)) {
    throw new Error(`uploaded URL would be rejected by isOurAsset: ${payload.secure_url}`);
  }
  return payload.secure_url;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
  // `--only` is always a correction, so it implies `--force`: without it the
  // targeted row would be skipped for already holding one of our assets, and the
  // script would report success having changed nothing.
  const force = args.includes('--force') || Boolean(only);

  if (args.includes('--credits')) {
    console.log('[demo:photos] sources and attribution\n');
    console.log('  PRODUCTS');
    for (const line of creditLines()) console.log(`    ${line}`);
    console.log('\n  SHOPS');
    for (const s of SHOP_PHOTOS) {
      console.log(`    ${s.shop} — ${s.credit} (${s.license}) — ${s.source}`);
    }
    console.log('\n  BANNERS');
    for (const b of BANNER_PHOTOS) {
      console.log(`    ${b.banner} — ${b.credit} (${b.license}) — ${b.source}`);
    }
    return;
  }

  if (!isLive() && !dryRun) {
    console.error('[demo:photos] no Cloudinary credentials in this environment.');
    console.error('              CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET must all be set.');
    console.error('              Refusing to write source URLs directly: `isOurAsset` would reject');
    console.error('              every one of them on the next product edit. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  // `--products` / `--shops` / `--banners` narrow the run; no flag means all.
  const picked = ['--products', '--shops', '--banners'].filter((f) => args.includes(f));
  const passes = picked.length
    ? PASSES.filter((p) => picked.includes(`--${p.name}`))
    : PASSES;

  if (only && !passes.some((p) => p.entries.some((e) => e.slug === only))) {
    console.error(`[demo:photos] no entry with slug "${only}".`);
    console.error('              Slugs are the second field of each entry in');
    console.error('              `productPhotos.js` and `shopPhotos.js`.');
    process.exitCode = 1;
    return;
  }

  const problems = [];
  let anyUploaded = false;

  for (const pass of passes) {
    const wanted = only ? pass.entries.filter((e) => e.slug === only) : pass.entries;
    if (!wanted.length) continue;

    const counts = { uploaded: 0, rows: 0, kept: 0, replaced: 0, failed: 0, missing: 0 };
    console.log(`\n[demo:photos] ${pass.name}`);

    for (const entry of wanted) {
      const label = pass.label(entry);
      const rows = await pass.find(label);

      if (!rows.length) {
        counts.missing += 1;
        problems.push(`no ${pass.name.slice(0, -1)} named "${label}" — ${pass.missingHint}`);
        continue;
      }

      // Ours already? Leave it. Anything else — null, or one of the five
      // `images.unsplash.com` URLs `prisma/seed.js` still carries — gets replaced.
      const stale = rows.filter(
        (r) => force || !pass.current(r) || !isOurAsset(pass.current(r), pass.kind)
      );
      if (!stale.length) {
        counts.kept += rows.length;
        continue;
      }

      // Counted separately from "had some image already", because these are the
      // only ones that were actually broken: a URL the API would refuse on the
      // next edit. Under `--force` every row has an image, and reporting all of
      // them as foreign would overstate what was wrong.
      const foreign = stale.filter(
        (r) => pass.current(r) && !isOurAsset(pass.current(r), pass.kind)
      ).length;

      if (dryRun) {
        console.log(`  would set ${stale.length} row(s) for "${label}"${foreign ? ` (${foreign} replacing a foreign URL)` : ''}`);
        counts.uploaded += 1;
        counts.rows += stale.length;
        counts.replaced += foreign;
        continue;
      }

      let url;
      try {
        url = await uploadOne(entry, pass.kind);
      } catch (err) {
        counts.failed += 1;
        problems.push(`"${label}": ${err.message}`);
        continue;
      }

      await pass.write(stale.map((r) => r.id), url);
      counts.uploaded += 1;
      counts.rows += stale.length;
      counts.replaced += foreign;
      anyUploaded = true;
      console.log(`  ✓ ${label}${stale.length > 1 ? ` (${stale.length} rows)` : ''}`);
    }

    console.log(`  ── ${pass.name}: ${counts.uploaded} photographed · ${counts.rows} rows · ${counts.replaced} foreign replaced · ${counts.kept} kept${
      counts.failed ? ` · ${counts.failed} FAILED` : ''
    }${counts.missing ? ` · ${counts.missing} not in this database` : ''}`);
  }

  // The other direction, and the one a silent script would hide: a row in the
  // database that these files have never heard of still renders a grey box.
  const knownProducts = new Set(PRODUCT_PHOTOS.map((p) => p.product));
  const knownShops = new Set(SHOP_PHOTOS.map((s) => s.shop));
  const orphanProducts = (
    await prisma.product.findMany({ where: { image: null }, select: { name: true }, distinct: ['name'] })
  ).map((p) => p.name).filter((n) => !knownProducts.has(n));
  const orphanShops = (
    await prisma.user.findMany({
      where: { role: 'SHOP', coverImageUrl: null },
      select: { name: true },
      distinct: ['name']
    })
  ).map((s) => s.name).filter((n) => !knownShops.has(n));

  console.log('');
  console.log(`[demo:photos] ${dryRun ? 'dry run — nothing was written' : 'done'}.`);

  if (problems.length) {
    console.log('');
    for (const p of problems) console.log(`  ⚠️  ${p}`);
  }
  for (const [what, list, file] of [
    ['product', orphanProducts, 'productPhotos.js'],
    ['shop', orphanShops, 'shopPhotos.js']
  ]) {
    if (!list.length) continue;
    console.log('');
    console.log(`  ⚠️  ${list.length} ${what} name(s) still have no photo and no entry in \`${file}\`.`);
    console.log('      Add one there, or upload from the Master dashboard:');
    for (const name of list.slice(0, 20)) console.log(`        · ${name}`);
    if (list.length > 20) console.log(`        … and ${list.length - 20} more`);
  }
  if (!dryRun && anyUploaded) {
    console.log('');
    console.log('  Attribution for the licences that require it: `npm run demo:photos -- --credits`.');
  }
}

main()
  .catch((err) => {
    console.error('[demo:photos] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
