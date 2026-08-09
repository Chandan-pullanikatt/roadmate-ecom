-- Rider pay (HANDOFF §3, revised 2026-08-07: riders are independent delivery
-- partners, not platform employees). Two new tables only — additive, nothing is
-- altered and no existing row is touched.
--
-- `riderEarning` / `deadRunFee` already exist on "DeliveryJob"; what was missing
-- was anywhere for the money to be *paid out*. These are the rider equivalent of
-- "Settlement" / "SettlementLine", kept separate because a shop settlement nets
-- commission off gross sales it collected and a rider settlement is a sum of
-- fees the platform owes outright.
--
-- Deliberately NOT included: the ConsumerOrder_addressId_fkey drop/re-add that
-- `migrate diff` emits. That is pre-existing drift from §1.9's hand-edited
-- migration and has nothing to do with rider pay; folding it in here would hide
-- it inside an unrelated change.

-- CreateTable
CREATE TABLE "RiderSettlement" (
    "id" SERIAL NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "deliveries" INTEGER NOT NULL DEFAULT 0,
    "deadRuns" INTEGER NOT NULL DEFAULT 0,
    "grossEarning" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deadRunFees" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMP(3),
    "utrNumber" TEXT,
    "riderId" INTEGER NOT NULL,

    CONSTRAINT "RiderSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSettlementLine" (
    "id" SERIAL NOT NULL,
    "earning" DECIMAL(12,2) NOT NULL,
    "isDeadRun" BOOLEAN NOT NULL DEFAULT false,
    "riderSettlementId" INTEGER NOT NULL,
    "deliveryJobId" INTEGER NOT NULL,

    CONSTRAINT "RiderSettlementLine_pkey" PRIMARY KEY ("id")
);

-- One settlement per rider per period: the shop-level re-run guard, for riders.
-- CreateIndex
CREATE UNIQUE INDEX "RiderSettlement_riderId_periodStart_key" ON "RiderSettlement"("riderId", "periodStart");

-- A job can appear on a settlement once. With the `lines: none` filter in
-- `runRiderSettlement()`, this is what makes an interrupted week safe to re-run.
-- CreateIndex
CREATE UNIQUE INDEX "RiderSettlementLine_riderSettlementId_deliveryJobId_key" ON "RiderSettlementLine"("riderSettlementId", "deliveryJobId");

-- AddForeignKey
ALTER TABLE "RiderSettlement" ADD CONSTRAINT "RiderSettlement_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSettlementLine" ADD CONSTRAINT "RiderSettlementLine_riderSettlementId_fkey" FOREIGN KEY ("riderSettlementId") REFERENCES "RiderSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSettlementLine" ADD CONSTRAINT "RiderSettlementLine_deliveryJobId_fkey" FOREIGN KEY ("deliveryJobId") REFERENCES "DeliveryJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
