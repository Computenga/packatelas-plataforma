-- Cambio de PAC: factura.com → Facturapi (la columna estaba vacía).
ALTER TABLE "Client" RENAME COLUMN "fcClientUid" TO "billingCustomerId";
