// Signed uploads. The only endpoint on the platform that hands a phone
// permission to write to the client's Cloudinary account — and it hands over a
// signature, never a secret (`lib/cloudinary.js` explains why at length).
//
// Two routes, two audiences, one handler each, because the two guards are not
// variants of each other: `protect` resolves a `User`, `protectCustomer`
// resolves a `Customer`, and a customer must not be able to sign a
// proof-of-delivery photo any more than a rider may sign a prescription. That
// separation is `kindsFor(audience)` and it is enforced here rather than
// trusted from the request.
//
// **No endpoint downstream changed.** `deliver()` has always taken `photoUrl`
// and `signatureUrl`, and the prescription endpoint has always taken
// `imageUrl` — Phase 1.9 chose URLs precisely so file storage could land later
// without touching them (PLAN §6). What is new is that those URLs are now
// checked against our own account (`isOurAsset`).
import { signUpload, kindsFor, isLive } from '../lib/cloudinary.js';

/**
 * The handler both routes share. `audience` decides which kinds are askable,
 * and it comes from the route table — never from the body.
 */
function handler(audience) {
  return (req, res) => {
    try {
      const allowed = kindsFor(audience);
      const kind = String(req.body?.kind ?? '').toUpperCase();

      if (!allowed.includes(kind)) {
        return res.status(400).json({
          message: 'Unknown upload kind.',
          reason: 'UNKNOWN_KIND',
          allowed
        });
      }

      // Not an error: the client may simply not have configured storage yet, and
      // four phases shipped around exactly that. A 200 saying `live: false` lets
      // the app say "photo proof is not set up" instead of showing a camera
      // button that dies at Cloudinary — the same call the Rider app already
      // makes about affordances that cannot work.
      if (!isLive()) {
        return res.status(200).json({
          status: 'success',
          upload: { live: false, kind, reason: 'NO_CREDENTIALS' }
        });
      }

      const ownerRef = typeof req.body?.ownerRef === 'string' ? req.body.ownerRef : undefined;
      return res.status(200).json({ status: 'success', upload: signUpload(kind, { ownerRef }) });
    } catch (error) {
      console.error('Sign Upload Error:', error);
      return res.status(500).json({ message: 'Server error while authorising the upload.' });
    }
  };
}

/** POST /api/uploads/signature — staff (a rider's proof of delivery). */
export const signStaffUpload = handler('rider');

/** POST /api/customer/uploads/signature — a customer's prescription. */
export const signCustomerUpload = handler('customer');

/**
 * POST /api/products/uploads/signature — a catalogue photo.
 *
 * A third audience rather than a widening of the staff one. A rider and a
 * catalogue manager are both `User`s behind the same `protect` guard, so
 * `kindsFor('rider')` would have started returning PRODUCT_IMAGE to every rider
 * on the platform the moment the kind was added — and the route table, not the
 * request, is what decides which kinds are askable. The role guard lives in
 * `app.js` alongside it.
 */
export const signProductUpload = handler('catalogue');

/**
 * POST /api/master/banners/uploads/signature — a home-screen banner (PHASE B).
 *
 * A fourth audience for the same reason as the third: merchandising is a
 * platform decision, so a manufacturer signing a product photo must not also be
 * able to put artwork on every customer's home screen. MASTER-guarded in
 * `app.js` on top of this.
 */
export const signBannerUpload = handler('merchandising');
