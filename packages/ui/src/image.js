// Ask the CDN for the size the screen actually draws.
//
// **The bug this fixes.** `seedDemoPhotos.js` stores Cloudinary's raw
// `secure_url` on `Product.image` and `User.coverImageUrl`, and every screen
// hands that straight to `<Image source={{ uri }}>`. So a photograph uploaded at
// 1600 px is downloaded whole to fill the 132×96 dp tile in `ProductTile`. A
// home screen with twenty tiles and a banner strip is tens of megabytes of
// pixels that are thrown away during decode — on a phone, on mobile data, in a
// country where that is metered. It is the most visible half of "the app feels
// slow": the layout arrives quickly and then the pictures fade in one by one.
//
// Cloudinary resizes in the URL, which is why it was chosen over S3 in the first
// place (HANDOFF, file storage). Nothing has to be re-uploaded, no thumbnail
// pipeline has to exist, and the stored URL does not change — this is a read-time
// decoration and the database is untouched.
//
//     …/image/upload/v1712/roadmate_products/abc.jpg
//     …/image/upload/f_auto,q_auto,c_fill,w_300/v1712/roadmate_products/abc.jpg
//
// `f_auto` serves WebP to Android, `q_auto` picks a quality per image, and `w_`
// is the real saving.
import { PixelRatio } from 'react-native';

// Widths are rounded up to a multiple of this. Every distinct width is a
// separate derived asset Cloudinary generates and bills for, so letting a
// three-density fleet of handsets ask for 264, 297 and 396 px would triple the
// transformations for pictures nobody could tell apart. Buckets mean a warm CDN
// cache and one derived image per bucket.
const WIDTH_STEP = 100;
const MAX_WIDTH = 1600;

/**
 * Is this a Cloudinary delivery URL we may rewrite?
 *
 * ⚠️ **`upload` only, never `authenticated`.** Prescriptions are stored as
 * `authenticated` assets and their delivery URLs are *signed* — the signature
 * covers the path, so inserting a transformation into one produces a 401 rather
 * than a smaller image. It is also the one asset class where the whole point is
 * that the bytes are hard to reach.
 */
const TRANSFORMABLE = '/image/upload/';

/**
 * Already carrying a transformation? Then leave it alone — whoever wrote it had
 * a reason, and stacking a second `w_` after theirs would silently win.
 *
 * A Cloudinary path segment is a transformation when it is a comma-separated
 * list of `xx_value` pairs. The version segment (`v1712…`) is not one, and
 * neither is a folder name.
 */
const alreadyTransformed = (rest) => /^[a-z]{1,3}_[^/]*(,|\/)/.test(rest);

/**
 * The URL for an image about to be drawn at `width` × `height` **dp**.
 *
 * Returns the input untouched for anything it does not recognise — a null, a
 * local `require()`d asset, a URL from somewhere that is not Cloudinary — so
 * call sites can wrap unconditionally and no screen needs to know where a
 * particular picture came from.
 *
 * @param {string|null|undefined} url
 * @param {{width?: number, height?: number, crop?: 'fill'|'fit'|'limit'}} [options]
 *   `width` is in layout dp; device pixels are worked out from `PixelRatio`.
 * @returns {string|null|undefined}
 */
export function sizedImage(url, { width, height, crop = 'fill' } = {}) {
  if (typeof url !== 'string' || !url) return url;

  const at = url.indexOf(TRANSFORMABLE);
  if (at === -1) return url;

  const head = url.slice(0, at + TRANSFORMABLE.length);
  const rest = url.slice(at + TRANSFORMABLE.length);
  if (alreadyTransformed(rest)) return url;

  const parts = ['f_auto', 'q_auto'];

  if (Number.isFinite(width) && width > 0) {
    // dp → real pixels on this handset, then up to the next bucket.
    const px = PixelRatio.getPixelSizeForLayoutSize(width);
    const bucketed = Math.min(MAX_WIDTH, Math.ceil(px / WIDTH_STEP) * WIDTH_STEP);
    parts.push(`c_${crop}`, `w_${bucketed}`);

    // Height only alongside a width, and only for the crops that use both.
    // `c_fill` with one dimension is a scale; with two it is the crop the tiles
    // actually want, so a wide photograph in a square thumbnail is centred
    // rather than squashed.
    if (Number.isFinite(height) && height > 0 && crop === 'fill') {
      const hpx = PixelRatio.getPixelSizeForLayoutSize(height);
      parts.push(`h_${Math.min(MAX_WIDTH, Math.ceil(hpx / WIDTH_STEP) * WIDTH_STEP)}`);
    }
  }

  return `${head}${parts.join(',')}/${rest}`;
}
