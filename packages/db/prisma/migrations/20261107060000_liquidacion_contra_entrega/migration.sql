-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "codHandedAt" TIMESTAMP(3),
ADD COLUMN     "codHandedById" TEXT,
ADD COLUMN     "codPayoutId" TEXT;

-- CreateTable
CREATE TABLE "CodPayout" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodPayout_clientId_paidAt_idx" ON "CodPayout"("clientId", "paidAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_codPayoutId_fkey" FOREIGN KEY ("codPayoutId") REFERENCES "CodPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodPayout" ADD CONSTRAINT "CodPayout_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

