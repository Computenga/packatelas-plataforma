-- CreateEnum
CREATE TYPE "MlCourierReportStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "MlCourierReport" (
    "id" TEXT NOT NULL,
    "shipmentId" BIGINT NOT NULL,
    "status" "MlCourierReportStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "response" TEXT,
    "lastError" TEXT,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlCourierReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MlCourierReport_shipmentId_key" ON "MlCourierReport"("shipmentId");

-- CreateIndex
CREATE INDEX "MlCourierReport_status_runAfter_idx" ON "MlCourierReport"("status", "runAfter");

