// Applying to be a delivery partner — the one part of this app that runs with no
// session at all (2026-08-11).
//
// `src/session.js` owns everything a signed-in rider does, and it is built around
// a token in SecureStore. An applicant has none: he has a phone number he can
// prove, and for fifteen minutes after proving it a **ticket**
// (`server/src/lib/riderSignupToken.js`).
//
// So the client here is deliberately **not** the session's. It has no `getToken`
// and no `onUnauthorized`, because:
//
//   • there is no token to attach, and
//   • a 401 on this surface means "your registration session expired, verify your
//     number again" — emphatically not "sign out", which is what the session's
//     handler does. Wiring these calls through that client would have a slow form
//     submission log a *different*, signed-in rider out of the app.
//
// The ticket is held in React state on the registration screen and passed into
// each call, rather than stored. It is a fifteen-minute credential for one action;
// persisting it to SecureStore would make it survive a reinstall it should not
// outlive, for no gain — if the applicant closes the app mid-form, re-proving the
// number costs one SMS.
import { createClient, riderSignupApi, uploadAsset, UploadError } from '@roadmate/api';
import * as ImagePicker from 'expo-image-picker';
import { API_URL } from './config.js';

/**
 * The unauthenticated API. A module singleton: it holds no per-user state, so
 * there is nothing to build per screen and nothing to tear down.
 */
export const signupApi = riderSignupApi(createClient({ baseUrl: API_URL }));

/**
 * Take (or choose) a photo of a document and upload it. Returns the asset URL, or
 * null if the applicant backed out — which is not a failure and must not be
 * reported as one.
 *
 * ⚠️ Mirrors `capturePhoto` in `proof.js` and does not share it: that one signs a
 * `POD_PHOTO` against a job id through the *session's* api, and this one signs a
 * `RIDER_DOC` against a ticket through the signup api. The two upload kinds are
 * separate audiences on the server precisely so neither can be used for the other,
 * and a shared helper would have to take both a session and a ticket to paper over
 * a difference that is the point.
 *
 * @param {string} ticket the signup ticket
 * @param {{ field: string, fromLibrary?: boolean }} options `field` only names the
 *   asset for support ("which of the two photos is this"), and is not trusted for
 *   anything — the server decides the folder from the kind.
 * @throws {UploadError} only when something genuinely went wrong
 */
export async function captureDocument(ticket, { field, fromLibrary = false } = {}) {
  const permission = fromLibrary
    ? await ImagePicker.requestMediaLibraryPermissionsAsync()
    : await ImagePicker.requestCameraPermissionsAsync();

  if (!permission.granted) {
    throw new UploadError(
      fromLibrary
        ? 'RoadMate needs permission to open your photos.'
        : 'RoadMate needs permission to use the camera. You can also choose a photo from your gallery.',
      { reason: 'NO_PERMISSION' }
    );
  }

  const picker = fromLibrary ? ImagePicker.launchImageLibraryAsync : ImagePicker.launchCameraAsync;
  const result = await picker({
    mediaTypes: ['images'],
    // Higher than a doorstep photo's 0.6: somebody has to *read a licence number*
    // off this, and an approver squinting at a compressed card is an approval made
    // on a guess. Still not 1.0 — an applicant is on mobile data too.
    quality: 0.8,
    allowsEditing: false,
    exif: false
  });

  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];

  const { upload } = await signupApi.signDocUpload(ticket, field);
  return uploadAsset(upload, {
    uri: asset.uri,
    name: asset.fileName ?? `${field}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize
  });
}

/**
 * Does this deployment have file storage at all?
 *
 * Asked once when the form opens, exactly as the job screen asks it: if the answer
 * is no, the document rows are **not rendered** rather than rendered and failing.
 * Documents are optional at the API for this reason — a deployment without
 * Cloudinary credentials must still be able to take applications — so a camera
 * button that could only ever error is the one thing this must not show.
 */
export async function uploadsAvailable(ticket) {
  try {
    const res = await signupApi.signDocUpload(ticket, 'probe');
    return Boolean(res?.upload?.live);
  } catch {
    // A failed probe is "no", not "maybe".
    return false;
  }
}

/**
 * The wording for a failed document upload. Every one ends with the same fact —
 * the application can still be sent — because it can, and an applicant who
 * believes otherwise will abandon the form over a camera permission.
 */
export function documentProblem(error) {
  if (!(error instanceof UploadError)) {
    return error?.message ?? 'Could not attach that. You can still send your application.';
  }
  switch (error.reason) {
    case 'NO_PERMISSION':
      return error.message;
    case 'NETWORK':
      return 'Could not reach photo storage. You can still send your application without it.';
    case 'TOO_LARGE':
      return 'That image is too large. Try taking a new photo instead of choosing one.';
    case 'SIGNATURE_EXPIRED':
      return 'That took a while — tap again to retry the upload.';
    default:
      return `${error.message} You can still send your application without it.`;
  }
}
