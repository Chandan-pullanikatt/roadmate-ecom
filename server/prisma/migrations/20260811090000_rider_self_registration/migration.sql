-- Riders apply for themselves (2026-08-11).
--
-- Until now nobody could become a RoadMate delivery partner without somebody
-- upstream typing them in: a field executive onboards platform riders
-- (`createPartner`), and a shop adds its own staff (`createShopRider`). Both
-- paths also *set the rider's password for him*, which is why "how do we get a
-- rider's password" had no good answer — it was whatever the person who created
-- the account chose, and there was no reset anywhere.
--
-- A rider now registers from the Rider app, proves the phone with an OTP,
-- submits his details, and waits for the district/regional desk to approve him.
-- The approval machinery is the one that already exists: he is created with
-- `isActive: false`, `getPendingApprovals` already lists EXECUTIVE rows, `login`
-- already refuses an inactive account, and `freeRidersNear` already requires
-- `isActive` — so a pending applicant is inert without a single guard being
-- added.
--
-- Three additive columns and one column-plus-index on OtpToken. No data
-- movement, no backfill, nothing dropped that carried data.
--
-- ─── 1. What the approver looks at ──────────────────────────────────────────
--
-- `User.aadhaarNumber` and `User.panNumber` already exist and are reused. What
-- a rider has and no other role does is a driving licence, and what makes an
-- approval a decision rather than a rubber stamp is being able to *see* the
-- documents.
--
-- The two URL columns hold Cloudinary assets of the new `RIDER_DOC` kind,
-- uploaded by the applicant himself during registration and re-checked with
-- `isOurAsset` before they are stored — an arbitrary URL in one of these is
-- refused, exactly as it is for a proof-of-delivery photo.
--
-- All three nullable. Every rider already on the platform was onboarded without
-- them and must stay valid; a NULL means "never collected", which is the truth
-- for an executive-onboarded partner and for every shop's own delivery boy.

ALTER TABLE "User" ADD COLUMN "licenceNumber" TEXT;
ALTER TABLE "User" ADD COLUMN "licenceDocUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "aadhaarDocUrl" TEXT;

-- ─── 2. Two OTP flows on one phone number ───────────────────────────────────
--
-- Registration and rider sign-in are both phone + OTP, which puts a second
-- issuer on the `OtpToken` table the Customer app has had to itself. One human
-- is very plausibly both a customer and a delivery partner on the same number.
--
-- `requestOtp` supersedes every live code for a phone, so that a superseded code
-- can no longer verify. Shared between two flows, that becomes cross-talk: a
-- rider mid-registration loses his code because the Customer app quietly
-- refreshed a session. `purpose` scopes both the supersede and the lookup, so
-- the two queues cannot cancel each other.
--
-- ⚠️ It is NOT a privilege boundary and must not be read as one. Any code proves
-- possession of the same phone number, and neither flow grants anything that
-- number does not already own. It exists so the flows do not collide.
--
-- Default "CUSTOMER_LOGIN" is precisely what every existing row is: the customer
-- login flow was the only issuer until today, so no backfill is needed and no
-- live code is invalidated by this migration.

ALTER TABLE "OtpToken" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'CUSTOMER_LOGIN';

-- The old index is replaced rather than kept alongside. Every lookup now
-- supplies a purpose — "newest live code for this phone, for this flow" — so
-- `(phone, purpose, expiresAt)` serves all of them, and `(phone, expiresAt)`
-- would be a second index maintained for no remaining query. `phone` is still
-- the leading column, so nothing loses its prefix.
DROP INDEX "OtpToken_phone_expiresAt_idx";
CREATE INDEX "OtpToken_phone_purpose_expiresAt_idx" ON "OtpToken"("phone", "purpose", "expiresAt");
