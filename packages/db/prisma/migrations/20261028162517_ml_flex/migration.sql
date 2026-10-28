-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "mlQrRaw" TEXT;

-- CreateTable
CREATE TABLE "MlFlexShipment" (
    "id" TEXT NOT NULL,
    "shipmentId" BIGINT NOT NULL,
    "mlAccountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "logisticType" TEXT,
    "mlStatus" TEXT,
    "mlSubstatus" TEXT,
    "mlOrderId" BIGINT,
    "packId" BIGINT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "addressLine" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "reference" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "itemsSummary" TEXT,
    "buyerNickname" TEXT,
    "mlCreatedAt" TIMESTAMP(3),
    "estimatedDelivery" TIMESTAMP(3),
    "qrRaw" TEXT,
    "orderId" TEXT,
    "scannedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlFlexShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MlFlexShipment_shipmentId_key" ON "MlFlexShipment"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MlFlexShipment_orderId_key" ON "MlFlexShipment"("orderId");

-- CreateIndex
CREATE INDEX "MlFlexShipment_logisticType_scannedAt_mlCreatedAt_idx" ON "MlFlexShipment"("logisticType", "scannedAt", "mlCreatedAt");

-- CreateIndex
CREATE INDEX "MlFlexShipment_clientId_idx" ON "MlFlexShipment"("clientId");

-- AddForeignKey
ALTER TABLE "MlFlexShipment" ADD CONSTRAINT "MlFlexShipment_mlAccountId_fkey" FOREIGN KEY ("mlAccountId") REFERENCES "MlAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlFlexShipment" ADD CONSTRAINT "MlFlexShipment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlFlexShipment" ADD CONSTRAINT "MlFlexShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

