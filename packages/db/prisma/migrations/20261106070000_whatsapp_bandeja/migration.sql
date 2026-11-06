-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "mediaId" TEXT,
    "mime" TEXT,
    "waId" TEXT,
    "status" TEXT,
    "error" TEXT,
    "contactName" TEXT,
    "userId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_waId_key" ON "WaMessage"("waId");

-- CreateIndex
CREATE INDEX "WaMessage_phone_createdAt_idx" ON "WaMessage"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "WaMessage_direction_readAt_idx" ON "WaMessage"("direction", "readAt");

-- CreateIndex
CREATE INDEX "WaMessage_createdAt_idx" ON "WaMessage"("createdAt");

