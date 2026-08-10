-- The storefront pass (2026-08-10). Four columns, one of them relaxed.
--
-- Hand-written rather than generated, for the same reason every migration in
-- this history is: Prisma's default for "make a required column nullable" is
-- safe, but its default for a new column on a live table is not always, and the
-- 28 orders / 30 items / 59 payouts that survived the Phase 0 rename are the
-- reason nobody trusts the generator here without reading it.
--
-- NOTHING IS ALTERED DESTRUCTIVELY AND NOTHING IS BACKFILLED:
--
--   • "Industry"."sortOrder" defaults to 0, so every existing row gets 0 and the
--     rail falls back to name order — exactly what it did before this column.
--   • "Banner"."imageUrl" goes from NOT NULL to NULL. Widening a constraint can
--     never fail on existing data: every current banner has an image and keeps
--     it. This is the one direction that is always safe, and it is the reverse
--     of it (adding NOT NULL later) that would need a backfill.
--   • "theme" and "ctaLabel" are nullable with no default. Null means "nobody
--     has decided", which for a theme is the design system's default card and
--     for a CTA is no button at all — the same "unset is not zero" rule
--     PlatformConfig holds (HANDOFF §7ter).

ALTER TABLE "Industry" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Banner" ALTER COLUMN "imageUrl" DROP NOT NULL;
ALTER TABLE "Banner" ADD COLUMN "theme" TEXT;
ALTER TABLE "Banner" ADD COLUMN "ctaLabel" TEXT;

-- The rail is read on every cold start of every customer's app, and it is read
-- in exactly this order. Six rows today, but the index costs nothing and the
-- query planner should never be sorting the platform's taxonomy at runtime.
CREATE INDEX "Industry_isActive_sortOrder_idx" ON "Industry"("isActive", "sortOrder");
