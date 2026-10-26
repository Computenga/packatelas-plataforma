import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { MlImportForm } from "./ml-import-form";

export const metadata: Metadata = { title: "Importar cuentas ML" };

export default async function ImportarMlPage() {
  await requireUser(["ADMIN"]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Clientes" title="Importar cuentas MercadoLibre">
        Liga cada cuenta de vendedor (el número que trae el QR de la etiqueta) con su cliente. Puedes repetir la carga: las cuentas
        ya ligadas se actualizan. Si el cliente tiene sucursal, la cuenta llega a la primera.
      </PageHeader>
      <MlImportForm />
    </div>
  );
}
