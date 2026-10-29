-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "fcClientUid" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "paymentForm" TEXT,
ADD COLUMN     "providerUid" TEXT,
ADD COLUMN     "requestedBy" TEXT,
ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_providerUid_key" ON "Invoice"("providerUid");

