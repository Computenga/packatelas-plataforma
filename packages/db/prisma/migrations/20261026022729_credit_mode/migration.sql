-- CreateEnum
CREATE TYPE "CreditMode" AS ENUM ('PREPAID', 'WEEKLY_CREDIT');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "creditMode" "CreditMode" NOT NULL DEFAULT 'PREPAID';
