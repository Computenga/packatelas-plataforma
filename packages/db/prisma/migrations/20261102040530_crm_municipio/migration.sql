-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "municipality" TEXT;

-- CreateIndex
CREATE INDEX "Lead_zone_municipality_idx" ON "Lead"("zone", "municipality");

