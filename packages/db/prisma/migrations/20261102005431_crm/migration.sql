-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NUEVO', 'CONTACTADO', 'INTERESADO', 'ALTA', 'ML_CONECTADO', 'PRIMER_ENVIO', 'ACTIVO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('REGISTRO_WEB', 'PRERREGISTRO', 'WHATSAPP', 'REFERIDO', 'REDES', 'VISITA', 'MANUAL');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'NUEVO',
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "phoneKey" TEXT,
    "email" TEXT,
    "zone" TEXT,
    "monthlyVolume" TEXT,
    "salesChannels" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "signupId" TEXT,
    "clientId" TEXT,
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_signupId_key" ON "Lead"("signupId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_clientId_key" ON "Lead"("clientId");

-- CreateIndex
CREATE INDEX "Lead_stage_updatedAt_idx" ON "Lead"("stage", "updatedAt");

-- CreateIndex
CREATE INDEX "Lead_nextActionAt_idx" ON "Lead"("nextActionAt");

-- CreateIndex
CREATE INDEX "Lead_phoneKey_idx" ON "Lead"("phoneKey");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

