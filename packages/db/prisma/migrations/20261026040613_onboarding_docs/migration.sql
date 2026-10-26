-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "HireStatus" AS ENUM ('EN_PROCESO', 'ENVIADA', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "DocType" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "positions" TEXT NOT NULL DEFAULT 'todos',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DocType_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "applicationId" TEXT,
    "docType" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT,
    "mime" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'PENDIENTE',
    "comment" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HireApplication" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "HireStatus" NOT NULL DEFAULT 'EN_PROCESO',
    "role" TEXT NOT NULL DEFAULT 'repartidor',
    "name" TEXT,
    "rfc" TEXT,
    "curp" TEXT,
    "nss" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "clabe" TEXT,
    "bank" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelation" TEXT,
    "notes" TEXT,
    "employeeId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HireApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingApp" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "kind" TEXT NOT NULL,
    "installUrl" TEXT,
    "openUrl" TEXT,
    "positions" TEXT NOT NULL DEFAULT 'todos',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OnboardingApp_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_docType_idx" ON "EmployeeDocument"("employeeId", "docType");

-- CreateIndex
CREATE INDEX "EmployeeDocument_applicationId_idx" ON "EmployeeDocument"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "HireApplication_tokenHash_key" ON "HireApplication"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "HireApplication_employeeId_key" ON "HireApplication"("employeeId");

-- CreateIndex
CREATE INDEX "HireApplication_status_createdAt_idx" ON "HireApplication"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HireApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Valores iniciales (los mismos del portal actual; editables después).
INSERT INTO "DocType" ("key", "name", "description", "positions", "required", "order", "active") VALUES
  ('ine_frente', 'INE (frente)', 'Foto clara, sin reflejos', 'todos', true, 10, true),
  ('ine_reverso', 'INE (reverso)', NULL, 'todos', true, 20, true),
  ('curp', 'CURP', 'Descárgala de gob.mx/curp', 'todos', true, 30, true),
  ('domicilio', 'Comprobante de domicilio', 'Luz, agua o teléfono, máximo 3 meses', 'todos', true, 40, true),
  ('csf', 'Constancia de situación fiscal (RFC)', 'Del SAT, con tu RFC', 'todos', true, 50, true),
  ('nss', 'Número de Seguro Social', 'Hoja o captura del IMSS con tu NSS', 'todos', true, 60, true),
  ('clabe', 'Estado de cuenta con CLABE', 'Carátula donde se vea tu nombre y CLABE (para tu nómina)', 'todos', true, 70, true),
  ('foto', 'Foto tuya de frente', 'Fondo claro, sin lentes ni gorra', 'todos', true, 80, true),
  ('licencia', 'Licencia de conducir vigente', 'Frente y reverso (puedes subir PDF o dos fotos en una)', 'repartidor', true, 90, true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "OnboardingApp" ("key", "name", "description", "icon", "kind", "installUrl", "openUrl", "positions", "required", "order", "active") VALUES
  ('packatelas', 'Packatelas', 'Esta app: tu ruta, escaneo, moto y asistencia', '📦', 'web', NULL, '/', 'repartidor', true, 10, true),
  ('whatsapp', 'WhatsApp Business', 'Comunicación con clientes', '💬', 'playstore', 'https://play.google.com/store/apps/details?id=com.whatsapp.w4b', 'https://wa.me/', 'todos', true, 20, true),
  ('zello', 'Zello', 'Radio con el equipo', '📻', 'playstore', 'https://play.google.com/store/apps/details?id=com.loudtalks', NULL, 'todos', true, 30, true),
  ('mydriver', 'My Driver', 'Entregas asignadas', '🚚', 'playstore', 'https://play.google.com/store/apps/details?id=com.my.driver', NULL, 'repartidor', true, 40, true),
  ('flex', 'Envíos Flex', 'Mercado Libre', '🟨', 'playstore', 'https://play.google.com/store/apps/details?id=com.mercadoenvios.driver', NULL, 'repartidor', true, 50, true),
  ('waze', 'Waze', 'Navegación', '🧭', 'playstore', 'https://play.google.com/store/apps/details?id=com.waze', 'https://waze.com/ul', 'repartidor', true, 60, true),
  ('maps', 'Google Maps', 'Navegación y direcciones', '🗺️', 'playstore', 'https://play.google.com/store/apps/details?id=com.google.android.apps.maps', 'https://maps.google.com/', 'repartidor', true, 70, true),
  ('telefono', 'Teléfono de Google', 'Llamadas', '📞', 'playstore', 'https://play.google.com/store/apps/details?id=com.google.android.dialer', NULL, 'repartidor', true, 80, true),
  ('mensajes', 'Mensajes de Google', 'SMS', '✉️', 'playstore', 'https://play.google.com/store/apps/details?id=com.google.android.apps.messaging', NULL, 'repartidor', true, 90, true),
  ('flotilla', 'Flotilla (app anterior)', 'Ya integrada en la pestaña Moto de esta app', '🛵', 'web', 'https://computenga.github.io/flotilla-packatelas/', NULL, 'repartidor', false, 100, false)
ON CONFLICT ("key") DO NOTHING;
