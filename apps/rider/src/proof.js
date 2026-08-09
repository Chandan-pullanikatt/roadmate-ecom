// Proof of delivery: the photo and the signature (2026-08-09).
//
// The half of proof-of-delivery Phase 3 shipped without, because there was
// nowhere to upload to. `deliver()` has always taken `photoUrl` and
// `signatureUrl`; nothing about that endpoint changed — the app uploads to
// Cloudinary first and sends the two URLs it gets back (PLAN §6).
//
// **The rule this file keeps is still the Rider app's own: no affordance that
// cannot work.** If the server has no Cloudinary credentials, the camera button
// is not rendered at all — not disabled, not present-and-failing. That is what
// `useUploadsAvailable` is for, and it is why availability is probed once when
// the job screen opens rather than discovered when a rider is standing at a door
// with a photo they cannot send.
//
// **Proof is optional, and must stay optional.** The OTP is the delivery. A
// rider whose camera permission is refused, whose phone has no storage left, or
// who is in a lift with no signal must still be able to close the job. Making
// the photo mandatory would make a broken camera into an undeliverable order.
import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { uploadAsset, UploadError } from '@roadmate/api';

/**
 * Does this deployment have file storage at all?
 *
 * One request when the screen mounts. It also warms nothing: the signature it
 * receives is deliberately discarded, because a signature is short-lived by
 * design and a rider may sit on a job card for half an hour. The upload itself
 * asks for a fresh one.
 */
export function useUploadsAvailable(api) {
  const [available, setAvailable] = useState(null); // null = still asking

  useEffect(() => {
    let cancelled = false;
    api
      .signProofUpload('POD_PHOTO')
      .then((res) => {
        if (!cancelled) setAvailable(Boolean(res?.upload?.live));
      })
      // A failed probe is "no", not "maybe". Showing a camera on a guess is the
      // thing this whole file exists to avoid.
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return available;
}

/**
 * Take (or choose) a photo and upload it. Returns the asset URL, or null if the
 * rider backed out — which is not a failure and must not be reported as one.
 *
 * @throws {UploadError} only when something genuinely went wrong
 */
export async function capturePhoto(api, { jobId, fromLibrary = false } = {}) {
  const permission = fromLibrary
    ? await ImagePicker.requestMediaLibraryPermissionsAsync()
    : await ImagePicker.requestCameraPermissionsAsync();

  if (!permission.granted) {
    throw new UploadError(
      fromLibrary
        ? 'RoadMate needs permission to open your photos.'
        : 'RoadMate needs permission to use the camera. You can still finish the delivery with the code.',
      { reason: 'NO_PERMISSION' }
    );
  }

  const picker = fromLibrary ? ImagePicker.launchImageLibraryAsync : ImagePicker.launchCameraAsync;
  const result = await picker({
    mediaTypes: ['images'],
    quality: 0.6, // a doorstep, not a portfolio — and riders are on mobile data
    allowsEditing: false,
    exif: false
  });

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];

  const { upload } = await api.signProofUpload('POD_PHOTO', `job${jobId}`);
  return uploadAsset(upload, {
    uri: asset.uri,
    name: asset.fileName ?? `pod-${jobId}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize
  });
}

/** Upload a signature already drawn on screen, as an SVG data URI. */
export async function uploadSignature(api, { jobId, dataUri }) {
  const { upload } = await api.signProofUpload('POD_SIGNATURE', `job${jobId}`);
  return uploadAsset(upload, {
    dataUri,
    name: `signature-${jobId}.svg`,
    type: 'image/svg+xml'
  });
}

/**
 * The wording for a failed upload. Every one of these ends with the same fact —
 * the delivery can still be completed — because it can, and a rider who thinks
 * otherwise will either stand there retrying or mark something wrongly.
 */
export function uploadProblem(error) {
  if (!(error instanceof UploadError)) {
    return error?.message ?? 'Could not attach that. You can still finish with the code.';
  }
  switch (error.reason) {
    case 'NO_PERMISSION':
      return error.message;
    case 'NETWORK':
      return 'Could not reach photo storage. You can still finish the delivery with the code.';
    case 'TOO_LARGE':
      return 'That image is too large. Try taking a new photo instead of choosing one.';
    case 'SIGNATURE_EXPIRED':
      return 'That took a while — tap again to retry the upload.';
    default:
      return `${error.message} You can still finish the delivery with the code.`;
  }
}
