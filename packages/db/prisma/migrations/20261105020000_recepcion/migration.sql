-- CreateEnum
CREATE TYPE "GateKind" AS ENUM ('LLEGADA', 'SALIDA');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RECEPCION';

-- CreateTable
CREATE TABLE "GateCheck" (
    "id" TEXT NOT NULL,
    "kind" "GateKind" NOT NULL,
    "driverId" TEXT NOT NULL,
    "guardId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ymd" TEXT NOT NULL,
    "identifiedBy" TEXT NOT NULL,
    "expected" JSONB NOT NULL,
    "scanned" JSONB NOT NULL,
    "extra" JSONB NOT NULL,
    "missing" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "audited" BOOLEAN NOT NULL DEFAULT false,
    "signatureKey" TEXT,

    CONSTRAINT "GateCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GateCheck_ymd_kind_idx" ON "GateCheck"("ymd", "kind");

-- CreateIndex
CREATE INDEX "GateCheck_driverId_at_idx" ON "GateCheck"("driverId", "at");

-- AddForeignKey
ALTER TABLE "GateCheck" ADD CONSTRAINT "GateCheck_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

