-- Gym vouchers: the shop sets price *and* duration (client answer, 2026-08-07).
-- Price was already per-shop, per-variant (`ShopInventory.sellingPrice`);
-- duration had nowhere to live, so `voucher_validity_days` (default 30) was
-- deciding a commercial term on the gym's behalf — PLAN §7.4, the one invented
-- number in the codebase.
--
-- One nullable column, added in place. Null means "not a timed variant", and
-- the config key demotes to what it should always have been: a fallback.

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "validityDays" INTEGER;
