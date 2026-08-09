/*
  Warnings:

  - You are about to alter the column `subtotal` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `taxAmount` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `deliveryFee` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `discountAmount` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `tipAmount` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `grandTotal` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `platformCommission` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `shopPayable` on the `ConsumerOrder` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `unitPrice` on the `ConsumerOrderItem` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `discountValue` on the `Coupon` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `maxDiscount` on the `Coupon` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `minOrderValue` on the `Coupon` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `riderEarning` on the `DeliveryJob` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `deadRunFee` on the `DeliveryJob` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `amount` on the `Payment` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `refundAmount` on the `Payment` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `price` on the `ProductAddOn` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `price` on the `ProductVariant` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `mrp` on the `ProductVariant` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `grossSales` on the `Settlement` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `commission` on the `Settlement` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `codCollected` on the `Settlement` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `deductions` on the `Settlement` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `netPayable` on the `Settlement` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `gross` on the `SettlementLine` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `commission` on the `SettlementLine` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `net` on the `SettlementLine` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - You are about to alter the column `sellingPrice` on the `ShopInventory` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.

*/
-- AlterTable
ALTER TABLE "ConsumerOrder" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "taxAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "deliveryFee" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "discountAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "tipAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "grandTotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "platformCommission" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "shopPayable" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ConsumerOrderItem" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Coupon" ALTER COLUMN "discountValue" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "maxDiscount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "minOrderValue" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "DeliveryJob" ALTER COLUMN "riderEarning" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "deadRunFee" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "refundAmount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ProductAddOn" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ProductVariant" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Settlement" ALTER COLUMN "grossSales" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "commission" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "codCollected" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "deductions" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "netPayable" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "SettlementLine" ALTER COLUMN "gross" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "commission" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "net" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ShopInventory" ALTER COLUMN "sellingPrice" SET DATA TYPE DECIMAL(12,2);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "userId" INTEGER,
    "customerId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_isActive_idx" ON "DeviceToken"("userId", "isActive");

-- CreateIndex
CREATE INDEX "DeviceToken_customerId_isActive_idx" ON "DeviceToken"("customerId", "isActive");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A device belongs to EITHER a staff User OR a Customer, never both and never
-- neither. Prisma cannot express this, so it is hand-added here.
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_owner_xor"
  CHECK (("userId" IS NULL) <> ("customerId" IS NULL));
