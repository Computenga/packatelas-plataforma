-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "legacyCarrierId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Driver_legacyCarrierId_key" ON "Driver"("legacyCarrierId");

