import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { BulkImport } from "./bulk-import";

export const metadata: Metadata = { title: "Carga masiva" };

export default async function CargaMasivaPage() {
  await requireUser(["ADMIN", "OPERADOR"]);
  const clients = await prisma.client.findMany({
    where: { active: true },
    select: { id: true, name: true, publicId: true, branches: { where: { active: true }, select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Pedidos" title="Carga masiva">
        Copia las celdas desde Excel o Google Sheets (con encabezados) y pégalas aquí, o sube un CSV. Se crean con código PK- y su cargo.
      </PageHeader>
      <BulkImport clients={clients} />
    </div>
  );
}
