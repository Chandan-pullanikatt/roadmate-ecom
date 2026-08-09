// Proof-of-delivery photo retention. `npm run prune:uploads`.
//
// A one-shot script like `runSettlement.js`, not a daemon like the sweeper.
// Point cron at it daily — it is cheap, and running it late only means photos
// live a little longer than the policy says.
//
// **Why this exists.** `lib/cloudinary.js` settled the retention question: a
// proof-of-delivery photo is kept `pod_photo_retention_days` (default 90) and
// then deleted. Nothing in Cloudinary enforces that on its own — an account
// left alone keeps every asset forever — so the decision is only real once this
// is scheduled. ⚠️ **If nobody schedules it, the answer to "how long are POD
// photos kept" is "forever", whatever the config row says.**
//
// **What it must never touch.** Prescriptions. They are tagged
// `roadmate_prescription`, this job only ever asks Cloudinary for
// `roadmate_pod`, and it deletes by explicit public id rather than by tag — so
// even a mistagged asset cannot be swept up by a wildcard. They are a medical
// record of why a pharmacy order was allowed to proceed and they have no expiry.
//
// **What it does not do:** null out `DeliveryJob.photoUrl`. The column records
// that a photo *was* taken at delivery, which is a fact about the delivery and
// stays true after the image is gone. A dead URL on a three-month-old job is
// the honest state; a nulled column would read as "the rider never took one".
import dotenv from 'dotenv';
import prisma from '../lib/prisma.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';
import { isLive, listByTag, deleteAssets, UPLOAD_KINDS } from '../lib/cloudinary.js';

dotenv.config();

const POD_TAG = UPLOAD_KINDS.POD_PHOTO.tag;

export async function prunePodPhotos({ now = new Date(), dryRun = false } = {}) {
  if (!isLive()) {
    console.log('[prune] Cloudinary is not configured — nothing to prune.');
    return { deleted: 0, skipped: true };
  }

  const days = await getConfigNumber(CONFIG_KEYS.POD_PHOTO_RETENTION_DAYS, null);
  if (!days || days <= 0) {
    console.log('[prune] pod_photo_retention_days is 0 or unset — keeping photos forever, as configured.');
    return { deleted: 0, skipped: true };
  }

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  console.log(`[prune] deleting POD photos created before ${cutoff.toISOString()} (${days} days)`);

  let cursor = null;
  let deleted = 0;
  let scanned = 0;

  do {
    const page = await listByTag(POD_TAG, { cursor });
    cursor = page.cursor;
    scanned += page.resources.length;

    // Oldest first, so the first asset newer than the cutoff means every
    // remaining page is newer too.
    const expired = page.resources.filter((r) => new Date(r.created_at) < cutoff);
    if (!expired.length) break;

    if (dryRun) {
      deleted += expired.length;
    } else {
      // POD photos are `type: upload`; a delete call assuming the wrong type
      // silently finds nothing, which would look exactly like success.
      const result = await deleteAssets(expired.map((r) => r.public_id), { type: 'upload' });
      deleted += Object.keys(result.deleted ?? {}).length;
    }

    if (expired.length < page.resources.length) break;
  } while (cursor);

  console.log(`[prune] scanned ${scanned}, ${dryRun ? 'would delete' : 'deleted'} ${deleted}`);
  return { deleted, scanned, cutoff };
}

// Only run when invoked directly, so a test can import the function above.
if (process.argv[1] && process.argv[1].endsWith('pruneUploads.js')) {
  prunePodPhotos({ dryRun: process.argv.includes('--dry-run') })
    .catch((err) => {
      console.error('[prune] failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
