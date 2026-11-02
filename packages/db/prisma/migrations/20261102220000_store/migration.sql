-- CreateEnum
CREATE TYPE "StoreOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StorePayMethod" AS ENUM ('SALDO', 'TARJETA');

-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'PURCHASE';

-- CreateTable
CREATE TABLE "StoreProduct" (
    "id" TEXT NOT NULL,
    "wooId" INTEGER NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "imageUrl" TEXT,
    "description" TEXT,
    "url" TEXT,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "StoreOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payMethod" "StorePayMethod" NOT NULL,
    "checkoutId" TEXT,
    "pickupId" TEXT,
    "createdById" TEXT,
    "paidAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreProduct_wooId_key" ON "StoreProduct"("wooId");

-- CreateIndex
CREATE INDEX "StoreProduct_active_inStock_category_idx" ON "StoreProduct"("active", "inStock", "category");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrder_number_key" ON "StoreOrder"("number");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrder_checkoutId_key" ON "StoreOrder"("checkoutId");

-- CreateIndex
CREATE INDEX "StoreOrder_status_createdAt_idx" ON "StoreOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StoreOrder_clientId_createdAt_idx" ON "StoreOrder"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "MpCheckout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

