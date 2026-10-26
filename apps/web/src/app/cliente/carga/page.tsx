import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { BulkImport } from "@/app/admin/pedidos/carga/bulk-import";

export const metadata: Metadata = { title: "Cargar envíos" };

export default async function CargaClientePage() {
  const { clientId } = await requireClient();
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { id: true, name: true, publicId: true, branches: { where: { active: true }, select: { id: true, name: true } } },
  });
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Cargar varios envíos</h1>
        <p className="text-sm text-slate-600">Copia las celdas desde Excel o Google Sheets (con encabezados) y pégalas, o sube un CSV.</p>
      </div>
      <BulkImport clients={[client]} fixed doneHref="/cliente" doneLabel="Ver mis envíos" />
    </div>
  );
}
