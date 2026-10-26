-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVO', 'TALLER', 'BAJA');

-- CreateEnum
CREATE TYPE "CheckKind" AS ENUM ('MATUTINO', 'ANTES_RUTA');

-- CreateEnum
CREATE TYPE "FaultStatus" AS ENUM ('ABIERTA', 'EN_REPARACION', 'CERRADA', 'DESCARTADA');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MECANICO';

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plate" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "vin" TEXT,
    "km" INTEGER NOT NULL DEFAULT 0,
    "size" TEXT NOT NULL DEFAULT 'grande',
    "ownership" TEXT NOT NULL DEFAULT 'empresa',
    "ownerId" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVO',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDocument" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "folio" TEXT,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "evidenceKey" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCheck" (
    "id" TEXT NOT NULL,
    "kind" "CheckKind" NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "km" INTEGER,
    "kmDriven" INTEGER,
    "photos" TEXT[],
    "odometerKey" TEXT,
    "description" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "VehicleCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLoad" (
    "id" TEXT NOT NULL,
    "checkId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(10,2) NOT NULL,
    "liters" DECIMAL(8,2),
    "ticketKey" TEXT,

    CONSTRAINT "FuelLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fault" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'reportada',
    "checkId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "responsibleId" TEXT,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'media',
    "photos" TEXT[],
    "status" "FaultStatus" NOT NULL DEFAULT 'ABIERTA',
    "mechanicNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repair" (
    "id" TEXT NOT NULL,
    "faultId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "mechanicUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "description" TEXT,
    "photos" TEXT[],
    "partsCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cause" TEXT,
    "responsibleId" TEXT,
    "employeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "companyAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Repair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCharge" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "repairId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_code_key" ON "Vehicle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDocument_vehicleId_type_key" ON "VehicleDocument"("vehicleId", "type");

-- CreateIndex
CREATE INDEX "VehicleCheck_vehicleId_at_idx" ON "VehicleCheck"("vehicleId", "at");

-- CreateIndex
CREATE INDEX "VehicleCheck_employeeId_at_idx" ON "VehicleCheck"("employeeId", "at");

-- CreateIndex
CREATE INDEX "FuelLoad_vehicleId_at_idx" ON "FuelLoad"("vehicleId", "at");

-- CreateIndex
CREATE INDEX "Fault_status_createdAt_idx" ON "Fault"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Repair_faultId_key" ON "Repair"("faultId");

-- CreateIndex
CREATE INDEX "Repair_closedAt_idx" ON "Repair"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeCharge_repairId_key" ON "EmployeeCharge"("repairId");

-- CreateIndex
CREATE INDEX "EmployeeCharge_employeeId_createdAt_idx" ON "EmployeeCharge"("employeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCheck" ADD CONSTRAINT "VehicleCheck_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLoad" ADD CONSTRAINT "FuelLoad_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "VehicleCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLoad" ADD CONSTRAINT "FuelLoad_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fault" ADD CONSTRAINT "Fault_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "VehicleCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fault" ADD CONSTRAINT "Fault_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repair" ADD CONSTRAINT "Repair_faultId_fkey" FOREIGN KEY ("faultId") REFERENCES "Fault"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repair" ADD CONSTRAINT "Repair_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCharge" ADD CONSTRAINT "EmployeeCharge_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "Repair"("id") ON DELETE SET NULL ON UPDATE CASCADE;
