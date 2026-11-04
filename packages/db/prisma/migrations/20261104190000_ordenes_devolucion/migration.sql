-- AlterEnum
ALTER TYPE "OrderKind" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "returnOrderId" TEXT;

-- CreateIndex
CREATE INDEX "Order_returnOrderId_idx" ON "Order"("returnOrderId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_returnOrderId_fkey" FOREIGN KEY ("returnOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Folio consecutivo de órdenes de devolución (DV-00001).
CREATE SEQUENCE IF NOT EXISTS "return_folio_seq" START 1;
