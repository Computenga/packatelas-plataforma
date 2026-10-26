import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, startOfTodayMx, STATUS_LABEL } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { Stat } from "@/components/stat";
import { ReturnStation } from "./return-station";

export const metadata: Metadata = { title: "Devoluciones" };

type Row = { id: string; code: string; status: keyof typeof STATUS_LABEL; updatedAt: Date; client: { id: string; name: string } };

function byClient(rows: Row[]) {
  const map = new Map<string, { name: string; rows: Row[] }>();
  for (const r of rows) {
    const g = map.get(r.client.id) ?? { name: r.client.name, rows: [] };
    g.rows.push(r);
    map.set(r.client.id, g);
  }
  return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
}

export default async function DevolucionesPage({ searchParams }: PageProps<"/admin/devoluciones">) {
  await requireUser(["ADMIN", "OPERADOR"]);
  const tab = String((await searchParams).tab ?? "recibir");
  const select = { id: true, code: true, status: true, updatedAt: true, client: { select: { id: true, name: true } } } as const;

  const [toReceive, inWarehouse, returnedToday] = await Promise.all([
    prisma.order.findMany({ where: { status: { in: ["FAILED", "RETURNING", "CANCELLED"] } }, select, orderBy: { updatedAt: "asc" }, take: 3000 }),
    prisma.order.findMany({ where: { status: "RETURNED_TO_WAREHOUSE" }, select, orderBy: { updatedAt: "asc" }, take: 3000 }),
    prisma.returnCustody.count({ where: { status: "RETURNED_TO_SELLER", returnedAt: { gte: startOfTodayMx() } } }),
  ]);
  const groups = byClient(tab === "almacen" ? inWarehouse : toReceive);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Operación" title="Devoluciones">
        Dos escaneos: el paquete llega a Packatelas y después se entrega al vendedor.
      </PageHeader>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Por recibir" value={toReceive.length} tone="red" hint={`${byClient(toReceive).length} vendedor(es)`} />
        <Stat label="En almacén" value={inWarehouse.length} tone="amber" hint="Listos para devolver" />
        <Stat label="Devueltos hoy" value={returnedToday} tone="green" />
      </div>

      <ReturnStation />

      <Card
        title={tab === "almacen" ? "En almacén, por vendedor" : "Por recibir, por vendedor"}
        actions={
          <div className="flex gap-3 text-sm">
            <Link href="/admin/devoluciones" className={tab !== "almacen" ? "font-semibold text-brand" : "text-slate-500"}>Por recibir</Link>
            <Link href="/admin/devoluciones?tab=almacen" className={tab === "almacen" ? "font-semibold text-brand" : "text-slate-500"}>En almacén</Link>
          </div>
        }
      >
        {groups.length === 0 && <p className="text-sm text-slate-500">Nada pendiente.</p>}
        <div className="space-y-4">
          {groups.map((g) => (
            <details key={g.name} className="rounded-lg border border-slate-200">
              <summary className="flex cursor-pointer justify-between px-4 py-2 text-sm">
                <span className="font-medium">{g.name}</span>
                <span className="text-slate-500">{g.rows.length} paquete(s)</span>
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex justify-between px-4 py-1.5">
                    <Link href={`/admin/pedidos/${r.id}`} className="font-mono text-xs text-brand hover:underline">{r.code}</Link>
                    <span className="text-xs text-slate-500">{STATUS_LABEL[r.status]} · {fecha(r.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}
