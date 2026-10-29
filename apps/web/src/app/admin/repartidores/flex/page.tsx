import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { FlexLinkPanel } from "./panel";

export const metadata: Metadata = { title: "Vincular drivers Flex" };

export default async function FlexDriversPage() {
  await requireUser(["ADMIN", "DESPACHADOR"]);
  const [drivers, links] = await Promise.all([
    prisma.driver.findMany({ where: { active: true, user: { active: true } }, include: { user: { select: { name: true, username: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.flexIdentity.findMany({ orderBy: { updatedAt: "desc" }, include: { driver: { include: { user: { select: { name: true, username: true } } } } } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Repartidores" title="Vincular drivers Flex">
        Para saber qué driver Flex de MercadoLibre es cada repartidor de Packatelas.
      </PageHeader>
      <Card title="1. El repartidor escanea un paquete en la app Flex de MercadoLibre">
        <p className="text-sm text-slate-600">Con eso MercadoLibre le asigna ese envío. Después busca aquí el mismo envío (número o QR) y te digo qué driver Flex lo tiene.</p>
      </Card>
      <Card title="2. Busca ese envío">
        <FlexLinkPanel drivers={drivers.map((d) => ({ id: d.id, name: d.user.name, username: d.user.username }))} />
      </Card>
      <Card title={`Vínculos actuales (${links.length})`}>
        {links.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay drivers Flex vinculados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Driver Flex</th><th>Repartidor</th><th>Último envío</th><th>Actualizado</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {links.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 font-mono">{l.flexDriverId.toString()}</td>
                  <td>{l.driver.user.name} <span className="font-mono text-xs text-slate-500">({l.driver.user.username})</span></td>
                  <td className="font-mono text-xs">{l.lastShipmentId?.toString() ?? "—"}</td>
                  <td>{fecha(l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
