-- CreateTable
CREATE TABLE "AppNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppNotice_userId_createdAt_idx" ON "AppNotice"("userId", "createdAt");
