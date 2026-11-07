-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "codAmount" DECIMAL(12,2),
ADD COLUMN     "codCollected" DECIMAL(12,2),
ADD COLUMN     "codCollectedAt" TIMESTAMP(3);

