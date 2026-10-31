-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "CustodyEnd" AS ENUM ('DELIVERED', 'RETURNED', 'TRANSFERRED', 'UNASSIGNED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "kind" "OrderKind" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "pickupId" TEXT;

-- CreateTable
CREATE TABLE "DriverCustody" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedById" TEXT,
    "how" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "CustodyEnd",
    "endedById" TEXT,

    CONSTRAINT "DriverCustody_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverCustody_driverId_endedAt_idx" ON "DriverCustody"("driverId", "endedAt");

-- CreateIndex
CREATE INDEX "DriverCustody_orderId_endedAt_idx" ON "DriverCustody"("orderId", "endedAt");

-- CreateIndex
CREATE INDEX "DriverCustody_endedAt_startedAt_idx" ON "DriverCustody"("endedAt", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_pickupId_key" ON "Order"("pickupId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCustody" ADD CONSTRAINT "DriverCustody_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCustody" ADD CONSTRAINT "DriverCustody_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Un solo registro abierto por pedido.
CREATE UNIQUE INDEX "DriverCustody_open_order_key" ON "DriverCustody"("orderId") WHERE "endedAt" IS NULL;

-- Inventario inicial: lo que hoy tiene cada repartidor (activos y entregados sin confirmar en ML + evidencia).
INSERT INTO "DriverCustody" ("id", "orderId", "driverId", "startedAt", "how")
SELECT 'cus_' || o."id", o."id", o."driverId",
       COALESCE((SELECT max(e."occurredAt") FROM "OrderEvent" e WHERE e."orderId" = o."id" AND e."type" IN ('assigned', 'scanned_loaded')), o."updatedAt"),
       'inicial'
FROM "Order" o
WHERE o."driverId" IS NOT NULL AND o."source" <> 'IMPORT' AND o."kind" = 'DELIVERY'
  AND (
    o."status" IN ('ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED', 'RESCHEDULED', 'RETURNING')
    OR (o."status" = 'DELIVERED' AND o."updatedAt" > now() - interval '30 days' AND (
         (o."mlShipmentId" IS NOT NULL AND COALESCE(o."mlStatus", '') <> 'delivered')
         OR NOT EXISTS (SELECT 1 FROM "Evidence" v WHERE v."orderId" = o."id" AND v."kind" = 'PHOTO')))
  );
