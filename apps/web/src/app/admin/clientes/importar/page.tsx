import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ClientImport } from "./client-import";

export const metadata: Metadata = { title: "Importar clientes" };

export default async function ImportarClientesPage() {
  await requireUser(["ADMIN"]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Clientes" title="Importar clientes">
        Para pasar los clientes del sistema actual: datos, tarifa, dirección de recolección y saldo. Puedes repetir la carga: los
        clientes que ya existen se actualizan y el saldo inicial se registra una sola vez.
      </PageHeader>
      <ClientImport />
    </div>
  );
}
