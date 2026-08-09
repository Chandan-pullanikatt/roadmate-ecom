// @roadmate/api — one description of the RoadMate API, shared by all three apps.
//
// No React, no storage, no navigation: this package is only "what the endpoints
// are and what they mean". The app supplies the base URL and a way to read the
// token; the app decides what to do with an `ApiError`.
export { createClient, ApiError } from './client.js';
export { shopApi } from './shop.js';
export { executiveApi } from './executive.js';
export { riderApi } from './rider.js';
export { customerApi } from './customer.js';
// Partner subscriptions (2026-08-09). Spread into both `shopApi` and
// `executiveApi` — the three billable roles span both surfaces.
export { billingApi } from './billing.js';
// File storage (2026-08-09). The apps upload straight to Cloudinary with a
// signature this API issues; the secret stays on the server. See the header.
export { uploadAsset, signatureToDataUri, UploadError } from './uploads.js';
