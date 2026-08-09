-- Staff sign-in by phone number, and the timestamp the subscription trial will
-- count from.
--
-- Two in-place ALTERs, no data movement, no drift.
--
-- 1. `User.phone` gets a UNIQUE index.
--
--    Checked against the live database before writing this (34 users, 11 with a
--    phone, **zero duplicates**, every one of them already a clean 10-digit
--    number). The 23 rows with a NULL phone are fine: Postgres treats NULLs as
--    distinct in a unique index, so any number of accounts may still have no
--    phone at all — which every web-dashboard-only role does.
--
--    The index is what makes "one human is one row" true. It only holds because
--    the application normalises before it writes (`src/lib/phone.js`: +91 / a
--    leading 0 / spaces / hyphens stripped, 10 digits, leading 6-9) — without
--    that, "+919876500011" and "9876500011" are two distinct index entries for
--    one person. The index and the normaliser are one mechanism in two places.
--
--    ⚠️ This is `CREATE UNIQUE INDEX`, not `ALTER COLUMN … SET NOT NULL`.
--    `phone` stays nullable on purpose: making it required would lock out every
--    existing account that has never had one.
--
-- 2. `User.approvedAt` — when a partner was activated.
--
--    `approvePartner` sets `isActive: true` and records nothing, so "when did
--    this shop get approved" is currently unanswerable. That date is what the
--    agreed 3-month free trial has to count from (the clock starts at approval,
--    not at signup — a partner cannot use the platform before they are
--    approved), and it is unrecoverable after the fact. Adding the column now
--    costs nothing and stops the first cohort's trial dates being guessed.
--
--    Nullable, and deliberately **not** backfilled from `createdAt`: the 34 rows
--    that predate this were approved at an unknown time, and inventing one would
--    be exactly the fabricated data this column exists to avoid. NULL means "we
--    do not know", which is the truth.

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

ALTER TABLE "User" ADD COLUMN "approvedAt" TIMESTAMP(3);
