-- Merchandising: banners, collections, and auto-applied coupons (PHASE B + C).
--
-- Fully additive: three new tables, one new boolean column with a default, and
-- two indexes. NOTHING IS ALTERED AND NOTHING IS BACKFILLED, so this is safe to
-- deploy ahead of the code that reads it — every existing coupon gets
-- autoApply=false, which is exactly the behaviour it has today.
--
-- Note for whoever reads this next: an earlier draft of this migration also
-- carried a DROP/ADD of ConsumerOrder_addressId_fkey. That was pre-existing
-- drift, not part of this feature — the database has had RESTRICT since Phase 0
-- and the schema had never said so, so Prisma kept wanting to move it to its
-- SetNull default. It is now declared explicitly in schema.prisma instead.
-- SetNull there would have quietly erased where a delivered order went.

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "autoApply" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Banner" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "imageUrl" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "industryId" INTEGER,
    "targetShopId" INTEGER,
    "targetProductId" INTEGER,
    "targetCouponId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "industryId" INTEGER,
    "shopId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "id" SERIAL NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "collectionId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,

    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Banner_isActive_validFrom_validTo_idx" ON "Banner"("isActive", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "Banner_industryId_idx" ON "Banner"("industryId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE INDEX "Collection_isActive_industryId_idx" ON "Collection"("isActive", "industryId");

-- CreateIndex
CREATE INDEX "CollectionItem_collectionId_position_idx" ON "CollectionItem"("collectionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionItem_collectionId_productId_key" ON "CollectionItem"("collectionId", "productId");

-- CreateIndex
CREATE INDEX "Coupon_autoApply_isActive_validFrom_validTo_idx" ON "Coupon"("autoApply", "isActive", "validFrom", "validTo");

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_targetShopId_fkey" FOREIGN KEY ("targetShopId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_targetCouponId_fkey" FOREIGN KEY ("targetCouponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
