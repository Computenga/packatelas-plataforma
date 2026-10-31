-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "NotificationStatus" ADD VALUE 'READ';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "statusAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_externalId_idx" ON "Notification"("externalId");

