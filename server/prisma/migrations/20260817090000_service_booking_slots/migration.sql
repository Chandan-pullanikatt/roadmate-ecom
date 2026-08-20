-- SERVICE_BOOKING — the calendar. A turf hour becomes something you can buy.
--
-- One new table and one nullable column. Nothing existing changes shape, so
-- every row already in `ConsumerOrder` is untouched and every other fulfilment
-- type reads exactly as it did.
--
-- WHY `ServiceSlot` IS NOT A `ShopInventory` ROW: a shelf holds a count of
-- interchangeable things; a slot is a specific hour at a specific price, and a
-- customer who wanted 6pm is not served by 8pm. Stock is a number, a slot is a
-- row. See `prisma/schema.prisma` and `src/lib/booking.js`.
--
-- `booked` mirrors `ShopInventory.reserved` deliberately — same claim discipline
-- (a conditional UPDATE under the row lock), because everybody wants the same
-- evening hour and this is the one write in this industry that genuinely races.

-- CreateTable
CREATE TABLE "ServiceSlot" (
    "id" SERIAL NOT NULL,
    "shopId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "priceOverride" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceSlot_shopId_startsAt_idx" ON "ServiceSlot"("shopId", "startsAt");

-- CreateIndex
CREATE INDEX "ServiceSlot_productId_startsAt_idx" ON "ServiceSlot"("productId", "startsAt");

-- CreateIndex
-- Re-opening a day the venue already opened is a skip, not a duplicate. This is
-- what makes `POST /api/shop/slots` safe to run twice.
CREATE UNIQUE INDEX "ServiceSlot_shopId_productId_startsAt_key" ON "ServiceSlot"("shopId", "productId", "startsAt");

-- AlterTable
-- Which hour this order booked. Null for every fulfilment type but SERVICE_BOOKING.
ALTER TABLE "ConsumerOrder" ADD COLUMN "slotId" INTEGER;

-- CreateIndex
CREATE INDEX "ConsumerOrder_slotId_idx" ON "ConsumerOrder"("slotId");

-- AddForeignKey
ALTER TABLE "ServiceSlot" ADD CONSTRAINT "ServiceSlot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSlot" ADD CONSTRAINT "ServiceSlot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSlot" ADD CONSTRAINT "ServiceSlot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT, like `addressId`: the slot is part of what this order was, and a
-- venue tidying its calendar must not erase what a customer bought. Closing a
-- slot is `isOpen = false`.
ALTER TABLE "ConsumerOrder" ADD CONSTRAINT "ConsumerOrder_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ServiceSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
