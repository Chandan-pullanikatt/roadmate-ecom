// Prescription upload (2026-08-09) — the one customer flow Phase 4 could not
// complete, and the reason was never the flow. `POST /api/customer/orders/:id/
// prescription` has taken a **URL** since §1.9 precisely so this could land
// later without touching the endpoint (PLAN §6); what was missing was somewhere
// to put the file.
//
// **Where the upload goes, and why it matters here more than anywhere else.**
// A prescription is a medical record. It is stored as a Cloudinary
// `authenticated` asset, which means its URL is not publicly fetchable — it has
// to be signed to be read, so a leaked or forwarded link stops working. The app
// does not choose that: the server bakes it into the signature it issues
// (`server/src/lib/cloudinary.js`), so this file could not make a prescription
// public if it tried. The same reason the retention job never touches them.
//
// **Uploading it does not approve it.** The order stays at PLACED until a
// verifier approves the image, and no shop sees the order before then. The
// screen says that, because a customer who thinks "uploaded" means "on its way"
// will wonder why nothing is happening.
//
// ⚠️ Second copy of this shape (the Rider app's `src/proof.js` is the first).
// Two is the cheaper trade; a third flips it into `packages/hooks`, which is
// exactly how `useResource` became a package.
import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { uploadAsset, UploadError } from '@roadmate/api';

/**
 * Does this deployment have file storage? One request on mount.
 *
 * The screen renders no camera button while this is null or false — a customer
 * offered an upload that cannot work is worse off than one told plainly that a
 * pharmacist will be in touch.
 */
export function useUploadsAvailable(api, orderId) {
  const [available, setAvailable] = useState(null);

  useEffect(() => {
    if (!orderId) return undefined;
    let cancelled = false;
    api
      .signPrescriptionUpload(orderId)
      .then((res) => {
        if (!cancelled) setAvailable(Boolean(res?.upload?.live));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, orderId]);

  return available;
}

/**
 * Photograph (or choose) the prescription, upload it, and attach it to the
 * order. Returns false if the customer backed out of the picker — not a
 * failure, and not something to report as one.
 */
export async function attachPrescription(api, { orderId, fromLibrary = false }) {
  const permission = fromLibrary
    ? await ImagePicker.requestMediaLibraryPermissionsAsync()
    : await ImagePicker.requestCameraPermissionsAsync();

  if (!permission.granted) {
    throw new UploadError(
      fromLibrary
        ? 'RoadMate needs permission to open your photos.'
        : 'RoadMate needs permission to use the camera.',
      { reason: 'NO_PERMISSION' }
    );
  }

  const picker = fromLibrary ? ImagePicker.launchImageLibraryAsync : ImagePicker.launchCameraAsync;
  const result = await picker({
    mediaTypes: ['images'],
    // Higher than the rider's doorstep photo on purpose: a pharmacist has to
    // read a doctor's handwriting off this, and a compressed 0.6 JPEG of a
    // prescription is how a legitimate order gets rejected.
    quality: 0.9,
    allowsEditing: true,
    exif: false
  });

  if (result.canceled || !result.assets?.length) return false;
  const asset = result.assets[0];

  const { upload } = await api.signPrescriptionUpload(orderId);
  const imageUrl = await uploadAsset(upload, {
    uri: asset.uri,
    name: asset.fileName ?? `prescription-${orderId}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize
  });

  // Only now does the order learn about it. If this call fails the image is an
  // orphan in storage, which is the harmless end of the two failure modes —
  // the other way round would be an order pointing at a file that never
  // uploaded.
  await api.uploadPrescription(orderId, imageUrl);
  return true;
}

/** What went wrong, in the customer's words. */
export function uploadProblem(error) {
  if (error instanceof UploadError) {
    switch (error.reason) {
      case 'NO_PERMISSION':
        return error.message;
      case 'NETWORK':
        return 'Could not upload the photo. Check your connection and try again.';
      case 'TOO_LARGE':
        return 'That image is too large. Take a new photo instead of choosing one.';
      case 'SIGNATURE_EXPIRED':
        return 'That took a while — tap again to retry.';
      default:
        return error.message;
    }
  }
  if (error?.status === 409) {
    return 'This order has moved on and can no longer take a prescription.';
  }
  return error?.message ?? 'Could not attach the prescription.';
}
