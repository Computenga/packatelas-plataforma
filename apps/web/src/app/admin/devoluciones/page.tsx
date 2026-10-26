import type { Metadata } from "next";
import Link from "next/link";
import { getMaxAttempts, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, startOfTodayMx, STATUS_LABEL } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { Stat } from "@/components/stat";
import { ReturnStation } from "./return-station";
import { ActionForm } from "@/components/action-form";
import { rescheduleAction } from "../pedidos/actions";
import { maxAttemptsAction } from "./actions";

export const metadata: Metadata = { title: "Devoluciones" };

type Row = { id: string; code: string; status: keyof typeof STATUS_LABEL; updatedAt: Date; client: { id: string; name: string }; driver: { user: { name: string } } | null };

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
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  const tab = String((await searchParams).tab ?? "recibir");
  const select = { id: true, code: true, status: true, updatedAt: true, client: { select: { id: true, name: true } }, driver: { select: { user: { select: { name: true } } } } } as const;

  const [toReceive, inWarehouse, returnedToday, maxAttempts] = await Promise.all([
    prisma.order.findMany({ where: { status: { in: ["FAILED", "RETURNING", "CANCELLED"] } }, select, orderBy: { updatedAt: "asc" }, take: 3000 }),
    prisma.order.findMany({ where: { status: "RETURNED_TO_WAREHOUSE" }, select, orderBy: { updatedAt: "asc" }, take: 3000 }),
    prisma.returnCustody.count({ where: { status: "RETURNED_TO_SELLER", returnedAt: { gte: startOfTodayMx() } } }),
    getMaxAttempts(prisma),
  ]);
  const inWarehouseTab = tab === "almacen";
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
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5">
                    <Link href={`/admin/pedidos/${r.id}`} className="font-mono text-xs text-brand hover:underline">{r.code}</Link>
                    <span className="flex items-center gap-3 text-xs text-slate-500">
                      {STATUS_LABEL[r.status]} · {fecha(r.updatedAt)}
                      {!inWarehouseTab && r.driver && ` · lo trae ${r.driver.user.name}`}
                      {inWarehouseTab && (
                        <form action={async (fd) => { "use server"; await rescheduleAction(r.id, {}, fd); }}>
                          <button className="text-brand hover:underline">Reintentar entrega</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Card>

      {user.role === "ADMIN" && (
        <Card title="Regla de regreso a bodega">
          <ActionForm action={maxAttemptsAction} submitLabel="Guardar" className="max-w-sm">
            <label className="block text-sm">
              <span className="text-slate-700">Intentos de entrega antes de regresar a bodega</span>
              <input type="number" name="max" min={1} max={10} defaultValue={maxAttempts} className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <p className="text-xs text-slate-500">Si el cliente rechaza el paquete, regresa a bodega desde el primer intento.</p>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
