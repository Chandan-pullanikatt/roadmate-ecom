// Uploading a file, from any of the three apps.
//
// **The phone never holds the Cloudinary API secret.** It asks our server for a
// signature (`signUpload`), which authorises exactly one upload of exactly one
// kind into exactly one folder, and then posts the bytes **straight to
// Cloudinary** with that signature attached. Two consequences worth stating,
// because both are the reason it is shaped this way:
//
//   • An `EXPO_PUBLIC_CLOUDINARY_API_SECRET` would be compiled into the APK and
//     readable by anybody who downloads it — and it is enough to delete every
//     asset in the client's account. So there is no such variable, and there
//     must never be one (`server/src/lib/cloudinary.js`).
//   • The bytes never transit our API. A 5 MB photo on a village 3G connection
//     would otherwise hold an Express worker open for the length of the upload.
//
// A signature is computed over the parameters, so the app sends back exactly
// what it was given (`signed.params`) and cannot widen the folder or turn a
// prescription public. Adding a parameter of your own here does not "add" it —
// it invalidates the signature and Cloudinary refuses the upload.

/** Thrown for any upload failure; kept separate from `ApiError` (HTTP to *us*). */
export class UploadError extends Error {
  constructor(message, { reason } = {}) {
    super(message);
    this.name = 'UploadError';
    this.reason = reason ?? null;
  }
}

/**
 * Post one file to Cloudinary with a server-issued signature.
 *
 * @param {object} signed the `upload` object from `signUpload`. When
 *   `signed.live` is false, storage is not configured on the server and this
 *   throws `NOT_CONFIGURED` — the caller is expected to have checked first and
 *   said so on screen rather than offering the affordance at all.
 * @param {{uri?: string, dataUri?: string, name: string, type: string, size?: number}} file
 *   `uri` for a picked photo (React Native's FormData understands
 *   `{uri, name, type}`); `dataUri` for something the app generated in memory,
 *   such as a signature drawn on the screen.
 * @returns {Promise<string>} the asset's `secure_url` — what every endpoint on
 *   this platform stores, because they all take URLs (PLAN §6).
 */
export async function uploadAsset(signed, file, { timeoutMs = 60000 } = {}) {
  if (!signed?.live) {
    throw new UploadError('Photo storage is not set up yet.', { reason: 'NOT_CONFIGURED' });
  }
  if (signed.maxBytes && file?.size && file.size > signed.maxBytes) {
    throw new UploadError('That image is too large.', { reason: 'TOO_LARGE' });
  }

  const form = new FormData();
  // Exactly the signed parameters, unchanged and nothing else signable.
  for (const [key, value] of Object.entries(signed.params)) form.append(key, String(value));
  form.append('api_key', signed.apiKey);
  form.append('signature', signed.signature);
  form.append(
    'file',
    file.dataUri ? file.dataUri : { uri: file.uri, name: file.name, type: file.type }
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(signed.uploadUrl, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    throw new UploadError(
      error?.name === 'AbortError'
        ? 'The upload took too long. Try again on a better connection.'
        : 'Could not reach photo storage.',
      { reason: 'NETWORK' }
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.secure_url) {
    // A stale signature is the common one: it is minutes old by design, and the
    // fix is to ask for a new one rather than to retry the same POST.
    throw new UploadError(payload?.error?.message ?? 'The upload was refused.', {
      reason: response.status === 401 ? 'SIGNATURE_EXPIRED' : 'REFUSED'
    });
  }

  return payload.secure_url;
}

/**
 * A signature drawn on the screen, as an SVG data URI ready for `uploadAsset`.
 *
 * Vector, deliberately. Rasterising a view needs `react-native-view-shot` — a
 * native module, a development build, and one more thing to keep working across
 * three apps — to produce something larger and blurrier than the path data the
 * app already has. This is a few kilobytes, is stored as a real image, and
 * needs nothing installed.
 *
 * @param {Array<Array<{x:number,y:number}>>} strokes one array of points per
 *   pen-down..pen-up
 * @param {{width:number, height:number}} size the pad's own dimensions, so the
 *   viewBox matches what the customer actually saw
 */
export function signatureToDataUri(strokes, { width, height }) {
  const paths = strokes
    .filter((points) => points.length > 0)
    .map((points) => {
      const d = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      return `<path d="${d}" fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" ` +
    `viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`;

  // Cloudinary's `file` parameter takes a **base64** data URI specifically, so
  // this is base64 and not `encodeURIComponent`. The SVG above is ASCII by
  // construction (path data, hex colours), which is why a 60-line encoder is
  // enough and no polyfill is needed — Hermes ships no `btoa`.
  return `data:image/svg+xml;base64,${base64Ascii(svg)}`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 for an ASCII string. Non-ASCII would be wrong here, so it is refused. */
function base64Ascii(input) {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const c1 = input.charCodeAt(i);
    const c2 = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c3 = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    if (c1 > 255 || c2 > 255 || c3 > 255) throw new UploadError('Signature data is not ASCII.');

    out += B64[c1 >> 2];
    out += B64[((c1 & 3) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4)];
    out += Number.isNaN(c2) ? '=' : B64[((c2 & 15) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6)];
    out += Number.isNaN(c3) ? '=' : B64[c3 & 63];
  }
  return out;
}
