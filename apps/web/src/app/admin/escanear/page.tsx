import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ScanStation } from "./scan-station";

export const metadata: Metadata = { title: "Escanear envíos" };

export default async function EscanearPage() {
  await requireUser(["ADMIN", "OPERADOR"]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Operación" title="Escanear envíos">
        Cada etiqueta crea el pedido en la sucursal correcta y registra el cargo del cliente. Escanear dos veces no
        duplica nada.
      </PageHeader>
      <ScanStation />
    </div>
  );
}
