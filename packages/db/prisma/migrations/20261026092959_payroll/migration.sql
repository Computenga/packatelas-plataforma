-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('BORRADOR', 'APROBADO', 'PAGADO');

-- CreateEnum
CREATE TYPE "PayrollLineKind" AS ENUM ('PERCEPCION', 'DEDUCCION');

-- CreateTable
CREATE TABLE "PayrollReceipt" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "quincena" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "dailySalary" DECIMAL(10,2) NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'BORRADOR',
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "kind" "PayrollLineKind" NOT NULL,
    "concept" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "chargeId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollReceipt_quincena_idx" ON "PayrollReceipt"("quincena");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollReceipt_employeeId_quincena_key" ON "PayrollReceipt"("employeeId", "quincena");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_chargeId_key" ON "PayrollLine"("chargeId");

-- AddForeignKey
ALTER TABLE "PayrollReceipt" ADD CONSTRAINT "PayrollReceipt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PayrollReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "EmployeeCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
