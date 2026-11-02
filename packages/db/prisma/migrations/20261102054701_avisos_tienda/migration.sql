-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyPrefs" JSONB;

-- CreateIndex
CREATE INDEX "OrderEvent_recordedAt_idx" ON "OrderEvent"("recordedAt");

