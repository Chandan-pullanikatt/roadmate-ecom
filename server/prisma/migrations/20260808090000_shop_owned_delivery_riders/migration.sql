-- Two delivery modes (HANDOFF §3, 2026-08-08): a shop either uses its own
-- delivery boys or RoadMate's delivery partners.
--
-- Additive only. Two nullable/defaulted columns and one index; nothing is
-- altered, dropped or backfilled. Every existing shop keeps using the platform
-- pool (`usesOwnRiders = false`) and every existing rider stays in it
-- (`employerShopId IS NULL`), which is exactly what they were doing before this
-- migration existed.

-- The shop is the switch.
ALTER TABLE "User" ADD COLUMN "usesOwnRiders" BOOLEAN NOT NULL DEFAULT false;

-- Who a rider works for. NULL = a RoadMate delivery partner.
ALTER TABLE "User" ADD COLUMN "employerShopId" INTEGER;

ALTER TABLE "User"
  ADD CONSTRAINT "User_employerShopId_fkey"
  FOREIGN KEY ("employerShopId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Both rider pools read this index: the platform's (employerShopId IS NULL) and
-- a shop's own (employerShopId = :shopId).
CREATE INDEX "User_role_executiveType_employerShopId_idx"
  ON "User"("role", "executiveType", "employerShopId");
