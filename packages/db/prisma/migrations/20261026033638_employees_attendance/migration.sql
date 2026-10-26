-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVO', 'BAJA');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rfc" TEXT,
    "curp" TEXT,
    "nss" TEXT,
    "position" TEXT,
    "area" TEXT,
    "kind" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVO',
    "hireDate" DATE,
    "endDate" DATE,
    "dailySalary" DECIMAL(10,2),
    "clabe" TEXT,
    "bank" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "entryTime" TEXT,
    "workdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "lunchMinutes" INTEGER NOT NULL DEFAULT 60,
    "punchesPerDay" INTEGER NOT NULL DEFAULT 2,
    "motoType" TEXT,
    "address" TEXT,
    "emergency" JSONB,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Punch" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT,
    "device" TEXT,
    "method" TEXT,
    "source" TEXT NOT NULL DEFAULT 'import',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Punch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Justification" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Justification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNo_key" ON "Employee"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Punch_externalId_key" ON "Punch"("externalId");

-- CreateIndex
CREATE INDEX "Punch_at_idx" ON "Punch"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Punch_employeeId_at_key" ON "Punch"("employeeId", "at");

-- CreateIndex
CREATE INDEX "Justification_date_idx" ON "Justification"("date");

-- AddForeignKey
ALTER TABLE "Punch" ADD CONSTRAINT "Punch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Justification" ADD CONSTRAINT "Justification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
