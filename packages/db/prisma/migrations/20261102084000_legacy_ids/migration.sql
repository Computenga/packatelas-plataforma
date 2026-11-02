-- AlterTable
ALTER TABLE "Fault" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "FuelLoad" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "Repair" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "VehicleCheck" ADD COLUMN     "legacyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Fault_legacyId_key" ON "Fault"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "FuelLoad_legacyId_key" ON "FuelLoad"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "Repair_legacyId_key" ON "Repair"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCheck_legacyId_key" ON "VehicleCheck"("legacyId");

