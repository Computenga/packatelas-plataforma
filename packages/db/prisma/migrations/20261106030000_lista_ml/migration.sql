-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'LISTA_ML';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "address" TEXT,
ADD COLUMN     "mlSellerId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_mlSellerId_key" ON "Lead"("mlSellerId");

