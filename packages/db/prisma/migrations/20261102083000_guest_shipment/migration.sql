-- CreateEnum
CREATE TYPE "GuestShipmentStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "GuestShipment" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "GuestShipmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "price" DECIMAL(12,2) NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderPhone" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupReference" TEXT,
    "pickupDate" DATE NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "instructions" TEXT,
    "contents" TEXT NOT NULL,
    "ip" TEXT,
    "orderId" TEXT,
    "pickupId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestShipment_token_key" ON "GuestShipment"("token");

-- CreateIndex
CREATE UNIQUE INDEX "GuestShipment_checkoutId_key" ON "GuestShipment"("checkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestShipment_orderId_key" ON "GuestShipment"("orderId");

-- CreateIndex
CREATE INDEX "GuestShipment_status_createdAt_idx" ON "GuestShipment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GuestShipment_ip_createdAt_idx" ON "GuestShipment"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "GuestShipment" ADD CONSTRAINT "GuestShipment_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "MpCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestShipment" ADD CONSTRAINT "GuestShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

