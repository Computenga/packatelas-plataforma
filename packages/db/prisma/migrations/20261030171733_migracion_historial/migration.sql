-- AlterEnum
ALTER TYPE "PaymentSource" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

