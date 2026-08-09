-- Phase 1.9 — the fulfilment-type branches.
--
-- Two in-place ALTERs, no data movement, no drift.
--
-- 1. `ConsumerOrder.addressId` becomes nullable. A NO_DELIVERY order (gym
--    membership) has no delivery address: it is a voucher redeemed in person.
--    Dropping NOT NULL cannot invalidate an existing row — every order already
--    in the table keeps its address.
-- 2. `User.prepTimeMin` — COOK_AND_DELIVER kitchen time, per shop, folded into
--    `ConsumerOrder.promisedEtaMin`. Nullable so an unset shop falls back to the
--    industry's `prep_time_min` PlatformConfig row rather than to a hardcoded 0.

ALTER TABLE "ConsumerOrder" ALTER COLUMN "addressId" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN "prepTimeMin" INTEGER;
