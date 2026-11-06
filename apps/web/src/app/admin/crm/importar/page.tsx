import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { LeadImport } from "./lead-import";
import { MlListImport } from "./ml-list-import";

export const metadata: Metadata = { title: "Importar prospectos" };

export default async function ImportarLeadsPage() {
  await requireUser(["ADMIN"]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="CRM" title="Importar prospectos" actions={<Link href="/admin/crm" className="text-sm text-brand hover:underline">← Volver al CRM</Link>}>
        Sube el CSV del formulario de registro (Google Sheets → Archivo → Descargar → CSV) u otra lista con negocio, nombre, teléfono y correo.
      </PageHeader>
      <Card title="Listado de vendedores de MercadoLibre">
        <MlListImport />
        <p className="mt-4 text-xs text-slate-500">
          El Excel que comparte ML (Seller ID, CUS_NICKNAME, CUS_PHONE1, CUS_PHONE2, CUS_EMAIL, CUS_CITY, CUS_STATE, CUS_ADDRESS). Los teléfonos se corrigen solos (52, 521, 1, 01, 044 y números de 8 dígitos con lada 55). No entran los que ya son clientes (por cuenta ML, teléfono o correo). Después invítalos en{" "}
          <Link href="/admin/crm/invitar-flex" className="text-brand hover:underline">CRM → Invitar a Flex</Link>.
        </p>
      </Card>
      <Card title="Prerregistros (formulario de Google)">
        <LeadImport />
        <p className="mt-4 text-xs text-slate-500">
          Se reconoce a quien ya es cliente por teléfono, correo o nombre del negocio: si se registró hace más de 60 días no entra; si se registró hace menos, entra ligado a su cliente y avanza solo. Si el mismo teléfono o correo ya está en el CRM, no se duplica. Puedes subir el mismo archivo otra vez sin problema.
        </p>
      </Card>
    </div>
  );
}
