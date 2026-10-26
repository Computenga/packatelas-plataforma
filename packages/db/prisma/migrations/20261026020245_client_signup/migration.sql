-- CreateEnum
CREATE TYPE "SignupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ClientSignup" (
    "id" TEXT NOT NULL,
    "status" "SignupStatus" NOT NULL DEFAULT 'PENDING',
    "businessName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupReference" TEXT,
    "monthlyVolume" TEXT,
    "salesChannels" TEXT,
    "rfc" TEXT,
    "legalName" TEXT,
    "taxRegime" TEXT,
    "taxZip" TEXT,
    "cfdiUse" TEXT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "clientId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientSignup_clientId_key" ON "ClientSignup"("clientId");

-- CreateIndex
CREATE INDEX "ClientSignup_status_createdAt_idx" ON "ClientSignup"("status", "createdAt");
