import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ScanStation } from "./scan-station";

export const metadata: Metadata = { title: "Escanear envíos" };

export default async function EscanearPage() {
  await requireUser(["ADMIN", "OPERADOR"]);
  // Solo importan las sucursales de cuentas ML que llegan a más de una [A02].
  const routes = await prisma.mlAccountRoute.findMany({
    where: { mlAccount: { routes: { some: { isDefault: false } } } },
    select: { branch: { select: { id: true, name: true, client: { select: { publicId: true, name: true } } } } },
  });
  const branches = [...new Map(routes.map((r) => [r.branch.id, r.branch])).values()].sort((a, b) =>
    a.client.publicId.localeCompare(b.client.publicId),
  );
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Operación" title="Escanear envíos">
        Cada etiqueta crea el pedido en la sucursal correcta y registra el cargo del cliente. Escanear dos veces no
        duplica nada.
      </PageHeader>
      <ScanStation branches={branches.map((b) => ({ id: b.id, label: `${b.client.publicId} · ${b.name}` }))} />
    </div>
  );
}
