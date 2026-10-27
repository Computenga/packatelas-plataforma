-- CreateEnum
CREATE TYPE "MpCheckoutStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REFUNDED');

-- CreateTable
CREATE TABLE "MpCheckout" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "preferenceId" TEXT,
    "mpPaymentId" TEXT,
    "status" "MpCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "detail" TEXT,
    "paymentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MpCheckout_preferenceId_key" ON "MpCheckout"("preferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "MpCheckout_mpPaymentId_key" ON "MpCheckout"("mpPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "MpCheckout_paymentId_key" ON "MpCheckout"("paymentId");

-- CreateIndex
CREATE INDEX "MpCheckout_status_createdAt_idx" ON "MpCheckout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MpCheckout_clientId_createdAt_idx" ON "MpCheckout"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "MpCheckout" ADD CONSTRAINT "MpCheckout_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

