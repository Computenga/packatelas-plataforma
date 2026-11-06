import type { Metadata } from "next";
import Link from "next/link";
import { prisma, searchReturnCandidates } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReturnBuilder } from "./builder";

export const metadata: Metadata = { title: "Nueva devolución" };

/** ?cliente=<id> precarga los paquetes de esa tienda que están en bodega. */
export default async function NuevaDevolucionPage({ searchParams }: PageProps<"/admin/devoluciones/nueva">) {
  const user = await requireUser(["ADMIN", "OPERADOR", "DESPACHADOR"]);
  const canAssign = user.role === "ADMIN" || user.role === "DESPACHADOR";
  const drivers = canAssign ? await prisma.driver.findMany({ where: { active: true, user: { active: true } }, select: { id: true, onDuty: true, user: { select: { name: true } } } }) : [];
  const driverOpts = drivers.map((d) => ({ id: d.id, name: d.user.name, onDuty: d.onDuty })).sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || a.name.localeCompare(b.name, "es"));
  const clientId = String((await searchParams).cliente ?? "");
  const initial = clientId ? (await searchReturnCandidates(prisma, "", clientId)).filter((c) => c.inWarehouse) : [];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/admin/devoluciones" className="text-sm text-brand hover:underline">← Devoluciones</Link>
      <PageHeader eyebrow="Devoluciones" title="Nueva orden de devolución">
        Junta los paquetes de una tienda (cancelados, fallidos o en bodega) en una orden con folio DV para asignarla a un repartidor. No se le cobra a la tienda.
      </PageHeader>
      <ReturnBuilder initial={initial} drivers={driverOpts} />
    </div>
  );
}
