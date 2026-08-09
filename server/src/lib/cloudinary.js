// File storage, via Cloudinary. The same shape as `razorpay.js` and `sms.js`:
// real when the environment carries credentials, a stub when it does not, and
// **no caller changes either way**. Credentials landed 2026-08-08 (HANDOFF §7).
//
// ── The one rule this file exists to enforce ────────────────────────────────
//
// **The API secret is server-only and never leaves this process.** It must
// never become an `EXPO_PUBLIC_*` variable: those are compiled into the APK and
// readable from it by anybody who downloads the app, and the secret is enough
// to overwrite or delete every asset in the client's account. So the phone
// never holds it. It asks for a **signature** — a one-shot authorisation to
// upload one asset, into one folder, of one kind — and posts the file straight
// to Cloudinary with that signature attached. The bytes never transit our API,
// which is also why a 4 MB proof-of-delivery photo on a village 3G connection
// does not hold an Express worker open for a minute.
//
// A signature authorises *exactly* the parameters it was computed over. The app
// cannot widen the folder, flip a prescription to public, or change the upload
// type without invalidating it — Cloudinary recomputes the same SHA-1 and
// refuses. That is why `UPLOAD_KINDS` below is a closed table and the caller
// picks a kind by name rather than sending us a folder.
//
// ── Two decisions settled here, both of which needed settling before the
//    photos accumulated rather than after (PLAN §8.1) ────────────────────────
//
//   • **Proof-of-delivery photos are kept 90 days, then deleted.** They exist to
//     answer "was this actually delivered", and that question is asked within
//     days — a COD dispute, a customer claiming a no-show. Kept forever they are
//     an ever-growing bill and an ever-growing pile of photographs of people's
//     front doors, taken by a stranger, that nobody has any remaining use for.
//     90 days is `pod_photo_retention_days` in `PlatformConfig`, not a constant,
//     and `npm run prune:uploads` (`src/jobs/pruneUploads.js`) is what enforces
//     it. ⚠️ Nothing enforces it until that job is scheduled — see the job.
//
//   • **Prescriptions are `type: authenticated`, and are never pruned.** They
//     are medical records, not product photos. An `upload`-type Cloudinary asset
//     is served from a public URL: guessable-adjacent, forwardable, and
//     cacheable by anything in between. `authenticated` means the delivery URL
//     must itself be signed and expires, so a URL that leaks is a URL that stops
//     working. And they are a legal record of why a pharmacy order was allowed
//     to proceed, so the retention job skips them by tag rather than by luck.
import crypto from 'node:crypto';

const cloudName = () => process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = () => process.env.CLOUDINARY_API_KEY;
const apiSecret = () => process.env.CLOUDINARY_API_SECRET;

/** True once the client's credentials are in the environment. */
export const isLive = () => Boolean(cloudName() && apiKey() && apiSecret());

// Cloudinary rejects a signature whose timestamp is more than an hour old. We
// hand out much shorter ones: an upload is something a human is doing right now.
const SIGNATURE_TTL_SECONDS = 600;

/**
 * Every kind of file this platform accepts, and the policy for each. A caller
 * names a kind; it never names a folder, a type or a tag, because those are
 * exactly the things the signature is protecting.
 *
 * `tag` is load-bearing: it is how `pruneUploads` tells a proof-of-delivery
 * photo it may delete from a prescription it must not.
 */
export const UPLOAD_KINDS = Object.freeze({
  POD_PHOTO: {
    folder: 'roadmate/pod/photo',
    // Public: a delivery photo is shown back to the rider and to support staff,
    // and signing every read of it buys nothing a 90-day life does not.
    type: 'upload',
    tag: 'roadmate_pod',
    maxBytes: 8 * 1024 * 1024,
    audience: 'rider'
  },
  POD_SIGNATURE: {
    folder: 'roadmate/pod/signature',
    type: 'upload',
    tag: 'roadmate_pod',
    maxBytes: 1 * 1024 * 1024,
    audience: 'rider'
  },
  PRESCRIPTION: {
    folder: 'roadmate/prescriptions',
    // ⚠️ Medical record. Never `upload`. See the header.
    type: 'authenticated',
    tag: 'roadmate_prescription',
    maxBytes: 8 * 1024 * 1024,
    audience: 'customer'
  }
});

/** The kinds a given audience may ask for. A customer cannot sign a POD photo. */
export function kindsFor(audience) {
  return Object.entries(UPLOAD_KINDS)
    .filter(([, policy]) => policy.audience === audience)
    .map(([kind]) => kind);
}

/**
 * Cloudinary's signature: the parameters that will be sent, minus `file`,
 * `api_key` and `resource_type`, sorted by key, joined `k=v&k=v`, with the API
 * secret appended, SHA-1'd.
 *
 * The app must send back *exactly* these parameters and no others that would
 * be signed — that is the whole security property, so `signUpload` returns the
 * params it signed rather than leaving the app to reconstruct them.
 */
function sign(params) {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(`${canonical}${apiSecret()}`).digest('hex');
}

/**
 * A one-shot authorisation for the app to upload one file of one kind.
 *
 * Stubs out without credentials, exactly like `createOrder` in `razorpay.js`:
 * the caller gets `live: false` and can say so on screen rather than walking
 * somebody through an upload that will 401 at Cloudinary. Nothing here throws.
 *
 * @param {keyof UPLOAD_KINDS} kind
 * @param {{ownerRef?: string, now?: Date}} [options] `ownerRef` is folded into
 *   the public id so an asset can be traced back to the job or order it belongs
 *   to without a database lookup. It is not a secret and must not be one.
 * @returns {{live: boolean, ...}}
 */
export function signUpload(kind, { ownerRef, now = new Date() } = {}) {
  const policy = UPLOAD_KINDS[kind];
  if (!policy) throw new Error(`Unknown upload kind: ${kind}`);

  if (!isLive()) {
    return { live: false, kind, reason: 'NO_CREDENTIALS' };
  }

  const timestamp = Math.floor(now.getTime() / 1000);
  // A collision would silently overwrite somebody else's proof of delivery, so
  // the random half is not decoration.
  const suffix = crypto.randomBytes(8).toString('hex');
  const safeRef = String(ownerRef ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  const publicId = safeRef ? `${safeRef}_${timestamp}_${suffix}` : `${timestamp}_${suffix}`;

  const params = {
    folder: policy.folder,
    public_id: publicId,
    tags: policy.tag,
    timestamp,
    type: policy.type
  };

  return {
    live: true,
    kind,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName()}/image/upload`,
    cloudName: cloudName(),
    apiKey: apiKey(),
    signature: sign(params),
    params,
    maxBytes: policy.maxBytes,
    // Informational: the app shows "start again" rather than a Cloudinary error
    // if the user leaves the camera open for ten minutes.
    expiresAt: new Date((timestamp + SIGNATURE_TTL_SECONDS) * 1000).toISOString()
  };
}

/**
 * Is this URL an asset in *our* Cloudinary account, of the kind we expected?
 *
 * Every upload endpoint on this platform takes a **URL** rather than bytes
 * (PLAN §6), which is what let four phases ship around file storage — but it
 * also means a client could post any URL on the internet and have us store it
 * as a prescription. Now that a real account exists, the URL a client hands
 * back must be one we authorised.
 *
 * ⚠️ **Without credentials this returns `true` for any http(s) URL.** That is
 * the same stub discipline as the rest of the file: the test suite and any
 * environment that has not been given keys must keep working, and there is
 * nothing to check a URL against when there is no account. The check is real
 * exactly where it matters — the environment holding the client's keys.
 */
export function isOurAsset(rawUrl, kind) {
  const policy = UPLOAD_KINDS[kind];
  if (!policy) throw new Error(`Unknown upload kind: ${kind}`);
  if (!isLive()) return true;

  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.hostname !== 'res.cloudinary.com') return false;

  // https://res.cloudinary.com/<cloud>/image/<type>/<transforms…>/<folder>/<id>
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== cloudName()) return false;
  if (segments[2] !== policy.type) return false;
  return url.pathname.includes(`/${policy.folder}/`);
}

// --- Admin API ---------------------------------------------------------------
// Used only by `src/jobs/pruneUploads.js`. Deliberately the smallest surface
// that job needs: list by tag, and delete by public id.

const adminAuth = () =>
  `Basic ${Buffer.from(`${apiKey()}:${apiSecret()}`).toString('base64')}`;

/**
 * One page of assets carrying `tag`, oldest first. Returns `{resources, cursor}`;
 * pass the cursor back for the next page.
 */
export async function listByTag(tag, { cursor, max = 100 } = {}) {
  if (!isLive()) return { resources: [], cursor: null, stub: true };

  const url = new URL(`https://api.cloudinary.com/v1_1/${cloudName()}/resources/image/tags/${encodeURIComponent(tag)}`);
  url.searchParams.set('max_results', String(max));
  url.searchParams.set('direction', 'asc');
  if (cursor) url.searchParams.set('next_cursor', cursor);

  const res = await fetch(url, {
    headers: { Authorization: adminAuth() },
    signal: AbortSignal.timeout(20_000)
  });
  if (!res.ok) throw new Error(`Cloudinary list failed: ${res.status}`);
  const payload = await res.json();
  return { resources: payload.resources ?? [], cursor: payload.next_cursor ?? null };
}

/**
 * Delete up to 100 assets by public id. `type` matters: an `authenticated`
 * asset is not found by a delete call that assumes `upload`.
 */
export async function deleteAssets(publicIds, { type = 'upload' } = {}) {
  if (!isLive()) return { deleted: {}, stub: true };
  if (!publicIds.length) return { deleted: {} };

  const url = new URL(`https://api.cloudinary.com/v1_1/${cloudName()}/resources/image/${type}`);
  for (const id of publicIds.slice(0, 100)) url.searchParams.append('public_ids[]', id);

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: adminAuth() },
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) throw new Error(`Cloudinary delete failed: ${res.status}`);
  return res.json();
}
