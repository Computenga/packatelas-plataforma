import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { LeadImport } from "./lead-import";

export const metadata: Metadata = { title: "Importar prospectos" };

export default async function ImportarLeadsPage() {
  await requireUser(["ADMIN"]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="CRM" title="Importar prospectos" actions={<Link href="/admin/crm" className="text-sm text-brand hover:underline">← Volver al CRM</Link>}>
        Sube el CSV del formulario de registro (Google Sheets → Archivo → Descargar → CSV) u otra lista con negocio, nombre, teléfono y correo.
      </PageHeader>
      <Card>
        <LeadImport />
        <p className="mt-4 text-xs text-slate-500">
          Quien ya es cliente desde hace más de 60 días no entra. Si es cliente reciente entra ligado y avanza solo. Si el mismo teléfono o correo ya está en el CRM, no se duplica. Puedes subir el mismo archivo otra vez sin problema.
        </p>
      </Card>
    </div>
  );
}
