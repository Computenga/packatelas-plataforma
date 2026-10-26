-- CreateEnum
CREATE TYPE "StorePlatform" AS ENUM ('WOOCOMMERCE', 'SHOPIFY');

-- CreateTable
CREATE TABLE "StoreConnector" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" "StorePlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "branchId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "received" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreConnector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreConnector_clientId_idx" ON "StoreConnector"("clientId");

-- AddForeignKey
ALTER TABLE "StoreConnector" ADD CONSTRAINT "StoreConnector_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
