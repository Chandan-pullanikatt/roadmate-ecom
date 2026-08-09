-- CreateEnum
CREATE TYPE "FulfilmentType" AS ENUM ('PICK_AND_DELIVER', 'COOK_AND_DELIVER', 'VERIFY_AND_DELIVER', 'NO_DELIVERY', 'SERVICE_BOOKING');


-- CreateEnum
CREATE TYPE "ConsumerOrderStatus" AS ENUM ('PLACED', 'ROUTING', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED', 'DELIVERED', 'CANCELLED');


-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'TIMED_OUT', 'STOCKOUT');


-- CreateEnum
CREATE TYPE "DeliveryJobType" AS ENUM ('LAST_MILE', 'TRADE_ROUTE');


-- CreateEnum
CREATE TYPE "DeliveryJobStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_DROP', 'DELIVERED', 'FAILED');


-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PREPAID', 'COD');


-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');


-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('OPEN', 'PENDING', 'PAID', 'FAILED');


-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('UPLOADED', 'APPROVED', 'REJECTED');


-- RenameTable: Order -> TradeOrder (B2B flow). Data preserved.
ALTER TABLE "Order" RENAME TO "TradeOrder";
ALTER TABLE "OrderItem" RENAME TO "TradeOrderItem";

-- RenameColumn
ALTER TABLE "TradeOrderItem" RENAME COLUMN "orderId" TO "tradeOrderId";
ALTER TABLE "Payout" RENAME COLUMN "orderId" TO "tradeOrderId";

-- RenameSequence
ALTER SEQUENCE "Order_id_seq" RENAME TO "TradeOrder_id_seq";
ALTER SEQUENCE "OrderItem_id_seq" RENAME TO "TradeOrderItem_id_seq";

-- RenameIndex
ALTER INDEX "Order_pkey" RENAME TO "TradeOrder_pkey";
ALTER INDEX "OrderItem_pkey" RENAME TO "TradeOrderItem_pkey";
ALTER INDEX "Order_orderNumber_key" RENAME TO "TradeOrder_orderNumber_key";

-- RenameForeignKey
ALTER TABLE "TradeOrder" RENAME CONSTRAINT "Order_buyerId_fkey" TO "TradeOrder_buyerId_fkey";
ALTER TABLE "TradeOrder" RENAME CONSTRAINT "Order_sellerId_fkey" TO "TradeOrder_sellerId_fkey";
ALTER TABLE "TradeOrder" RENAME CONSTRAINT "Order_industryId_fkey" TO "TradeOrder_industryId_fkey";
ALTER TABLE "TradeOrderItem" RENAME CONSTRAINT "OrderItem_orderId_fkey" TO "TradeOrderItem_tradeOrderId_fkey";
ALTER TABLE "TradeOrderItem" RENAME CONSTRAINT "OrderItem_productId_fkey" TO "TradeOrderItem_productId_fkey";
ALTER TABLE "Payout" RENAME CONSTRAINT "Payout_orderId_fkey" TO "Payout_tradeOrderId_fkey";

-- AlterTable
ALTER TABLE "Industry" ADD COLUMN     "fulfilmentType" "FulfilmentType" NOT NULL DEFAULT 'PICK_AND_DELIVER',
ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;


-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "categoryId" INTEGER,
ADD COLUMN     "isVeg" BOOLEAN,
ADD COLUMN     "mrp" DOUBLE PRECISION;


-- AlterTable
ALTER TABLE "User" ADD COLUMN     "closeTime" TEXT,
ADD COLUMN     "coverImageUrl" TEXT,
ADD COLUMN     "creditLimit" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "fulfilmentRate" DOUBLE PRECISION DEFAULT 100,
ADD COLUMN     "isOnShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isOpen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "openTime" TEXT,
ADD COLUMN     "outstandingDue" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "routingPriority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceRadiusKm" DOUBLE PRECISION DEFAULT 5;


-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "iconUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "industryId" INTEGER NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "mrp" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "productId" INTEGER NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "ProductAddOn" (
    "id" SERIAL NOT NULL,
    "groupName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "productId" INTEGER NOT NULL,

    CONSTRAINT "ProductAddOn_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "ShopInventory" (
    "id" SERIAL NOT NULL,
    "shopId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "sellingPrice" DOUBLE PRECISION NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "consecutiveStockouts" INTEGER NOT NULL DEFAULT 0,
    "lastConfirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopInventory_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "OtpToken" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpToken_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Address" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "customerId" INTEGER NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Cart" (
    "id" SERIAL NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "shopId" INTEGER,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "CartItem" (
    "id" SERIAL NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "addOnIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "note" TEXT,
    "cartId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "ConsumerOrder" (
    "id" SERIAL NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "ConsumerOrderStatus" NOT NULL DEFAULT 'PLACED',
    "customerId" INTEGER NOT NULL,
    "addressId" INTEGER NOT NULL,
    "industryId" INTEGER NOT NULL,
    "shopId" INTEGER,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tipAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "platformCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shopPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "couponId" INTEGER,
    "instructions" TEXT,
    "promisedEtaMin" INTEGER,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumerOrder_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "ConsumerOrderItem" (
    "id" SERIAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "addOnsJson" JSONB,
    "productName" TEXT NOT NULL,
    "consumerOrderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,

    CONSTRAINT "ConsumerOrderItem_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "FulfilmentAttempt" (
    "id" SERIAL NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'OFFERED',
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "reason" TEXT,
    "consumerOrderId" INTEGER NOT NULL,
    "shopId" INTEGER NOT NULL,

    CONSTRAINT "FulfilmentAttempt_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "DeliveryJob" (
    "id" SERIAL NOT NULL,
    "type" "DeliveryJobType" NOT NULL DEFAULT 'LAST_MILE',
    "status" "DeliveryJobStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "riderId" INTEGER,
    "consumerOrderId" INTEGER,
    "tradeOrderId" INTEGER,
    "routeId" INTEGER,
    "stopSequence" INTEGER,
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "dropLat" DOUBLE PRECISION,
    "dropLng" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "otpCode" TEXT,
    "otpVerifiedAt" TIMESTAMP(3),
    "signatureUrl" TEXT,
    "photoUrl" TEXT,
    "deliveryNote" TEXT,
    "riderEarning" DOUBLE PRECISION,
    "isDeadRun" BOOLEAN NOT NULL DEFAULT false,
    "deadRunFee" DOUBLE PRECISION,
    "assignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryJob_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "DeliveryRoute" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalStops" INTEGER NOT NULL DEFAULT 0,
    "totalKm" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "riderId" INTEGER NOT NULL,

    CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "RiderShift" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "zoneNote" TEXT,
    "riderId" INTEGER NOT NULL,

    CONSTRAINT "RiderShift_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DOUBLE PRECISION NOT NULL,
    "consumerOrderId" INTEGER NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "collectedByRiderId" INTEGER,
    "cashCollectedAt" TIMESTAMP(3),
    "cashRemittedAt" TIMESTAMP(3),
    "refundAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Settlement" (
    "id" SERIAL NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codCollected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMP(3),
    "utrNumber" TEXT,
    "shopId" INTEGER NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "SettlementLine" (
    "id" SERIAL NOT NULL,
    "gross" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "net" DOUBLE PRECISION NOT NULL,
    "settlementId" INTEGER NOT NULL,
    "consumerOrderId" INTEGER NOT NULL,

    CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "maxDiscount" DOUBLE PRECISION,
    "minOrderValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "industryId" INTEGER,
    "shopId" INTEGER,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Prescription" (
    "id" SERIAL NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'UPLOADED',
    "verifiedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "consumerOrderId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "verifiedById" INTEGER,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Voucher" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "qrPayload" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "consumerOrderId" INTEGER NOT NULL,
    "redeemedByShopId" INTEGER,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "industryId" INTEGER,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "Category_industryId_slug_key" ON "Category"("industryId", "slug");


-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_label_key" ON "ProductVariant"("productId", "label");


-- CreateIndex
CREATE INDEX "ProductAddOn_productId_idx" ON "ProductAddOn"("productId");


-- CreateIndex
CREATE INDEX "ShopInventory_productId_idx" ON "ShopInventory"("productId");


-- CreateIndex
CREATE UNIQUE INDEX "ShopInventory_shopId_productId_variantId_key" ON "ShopInventory"("shopId", "productId", "variantId");


-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");


-- CreateIndex
CREATE INDEX "OtpToken_phone_expiresAt_idx" ON "OtpToken"("phone", "expiresAt");


-- CreateIndex
CREATE INDEX "Address_customerId_idx" ON "Address"("customerId");


-- CreateIndex
CREATE UNIQUE INDEX "Cart_customerId_shopId_key" ON "Cart"("customerId", "shopId");


-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");


-- CreateIndex
CREATE UNIQUE INDEX "ConsumerOrder_orderNumber_key" ON "ConsumerOrder"("orderNumber");


-- CreateIndex
CREATE INDEX "ConsumerOrder_customerId_placedAt_idx" ON "ConsumerOrder"("customerId", "placedAt");


-- CreateIndex
CREATE INDEX "ConsumerOrder_shopId_status_idx" ON "ConsumerOrder"("shopId", "status");


-- CreateIndex
CREATE INDEX "ConsumerOrderItem_consumerOrderId_idx" ON "ConsumerOrderItem"("consumerOrderId");


-- CreateIndex
CREATE INDEX "FulfilmentAttempt_status_expiresAt_idx" ON "FulfilmentAttempt"("status", "expiresAt");


-- CreateIndex
CREATE INDEX "FulfilmentAttempt_shopId_status_idx" ON "FulfilmentAttempt"("shopId", "status");


-- CreateIndex
CREATE UNIQUE INDEX "FulfilmentAttempt_consumerOrderId_sequence_key" ON "FulfilmentAttempt"("consumerOrderId", "sequence");


-- CreateIndex
CREATE INDEX "DeliveryJob_riderId_status_idx" ON "DeliveryJob"("riderId", "status");


-- CreateIndex
CREATE INDEX "DeliveryJob_status_type_idx" ON "DeliveryJob"("status", "type");


-- CreateIndex
CREATE INDEX "DeliveryRoute_riderId_date_idx" ON "DeliveryRoute"("riderId", "date");


-- CreateIndex
CREATE INDEX "RiderShift_riderId_endedAt_idx" ON "RiderShift"("riderId", "endedAt");


-- CreateIndex
CREATE UNIQUE INDEX "Payment_consumerOrderId_key" ON "Payment"("consumerOrderId");


-- CreateIndex
CREATE INDEX "Payment_collectedByRiderId_cashRemittedAt_idx" ON "Payment"("collectedByRiderId", "cashRemittedAt");


-- CreateIndex
CREATE UNIQUE INDEX "Settlement_shopId_periodStart_key" ON "Settlement"("shopId", "periodStart");


-- CreateIndex
CREATE UNIQUE INDEX "SettlementLine_settlementId_consumerOrderId_key" ON "SettlementLine"("settlementId", "consumerOrderId");


-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");


-- CreateIndex
CREATE INDEX "Prescription_consumerOrderId_idx" ON "Prescription"("consumerOrderId");


-- CreateIndex
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");


-- CreateIndex
CREATE INDEX "Voucher_consumerOrderId_idx" ON "Voucher"("consumerOrderId");


-- CreateIndex
CREATE UNIQUE INDEX "PlatformConfig_key_industryId_key" ON "PlatformConfig"("key", "industryId");


-- CreateIndex
CREATE INDEX "User_role_latitude_longitude_idx" ON "User"("role", "latitude", "longitude");


-- CreateIndex
CREATE INDEX "User_role_executiveType_isOnShift_idx" ON "User"("role", "executiveType", "isOnShift");


-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ProductAddOn" ADD CONSTRAINT "ProductAddOn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ShopInventory" ADD CONSTRAINT "ShopInventory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ShopInventory" ADD CONSTRAINT "ShopInventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ShopInventory" ADD CONSTRAINT "ShopInventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrder" ADD CONSTRAINT "ConsumerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrder" ADD CONSTRAINT "ConsumerOrder_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrder" ADD CONSTRAINT "ConsumerOrder_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrder" ADD CONSTRAINT "ConsumerOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrder" ADD CONSTRAINT "ConsumerOrder_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrderItem" ADD CONSTRAINT "ConsumerOrderItem_consumerOrderId_fkey" FOREIGN KEY ("consumerOrderId") REFERENCES "ConsumerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrderItem" ADD CONSTRAINT "ConsumerOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ConsumerOrderItem" ADD CONSTRAINT "ConsumerOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "FulfilmentAttempt" ADD CONSTRAINT "FulfilmentAttempt_consumerOrderId_fkey" FOREIGN KEY ("consumerOrderId") REFERENCES "ConsumerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "FulfilmentAttempt" ADD CONSTRAINT "FulfilmentAttempt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "DeliveryJob" ADD CONSTRAINT "DeliveryJob_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "DeliveryJob" ADD CONSTRAINT "DeliveryJob_consumerOrderId_fkey" FOREIGN KEY ("consumerOrderId") REFERENCES "ConsumerOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "DeliveryJob" ADD CONSTRAINT "DeliveryJob_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "TradeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "DeliveryJob" ADD CONSTRAINT "DeliveryJob_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "RiderShift" ADD CONSTRAINT "RiderShift_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_consumerOrderId_fkey" FOREIGN KEY ("consumerOrderId") REFERENCES "ConsumerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedByRiderId_fkey" FOREIGN KEY ("collectedByRiderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_consumerOrderId_fkey" FOREIGN KEY ("consumerOrderId") REFERENCES "ConsumerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_consumerOrderId_fkey" FOREIGN KEY ("consumerOrderId") REFERENCES "ConsumerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_consumerOrderId_fkey" FOREIGN KEY ("consumerOrderId") REFERENCES "ConsumerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_redeemedByShopId_fkey" FOREIGN KEY ("redeemedByShopId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "PlatformConfig" ADD CONSTRAINT "PlatformConfig_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
