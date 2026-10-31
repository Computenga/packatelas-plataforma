import type { Metadata } from "next";
import Link from "next/link";
import { custodyFlag, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { period } from "./period";

export const metadata: Metadata = { title: "Inventario" };
const requestTime = () => new Date();

export default async function InventarioPage({ searchParams }: PageProps<"/admin/inventario">) {
  await requireUser(["ADMIN", "DESPACHADOR"]);
  const now = requestTime();
  const p = period(await searchParams, now);
  const inPeriod = { gte: p.from, lt: p.to };

  const [drivers, open, started, ended] = await Promise.all([
    prisma.driver.findMany({ select: { id: true, user: { select: { name: true, active: true } } } }),
    prisma.driverCustody.findMany({
      where: { endedAt: null },
      select: {
        driverId: true,
        startedAt: true,
        order: { select: { status: true, mlShipmentId: true, mlStatus: true, _count: { select: { evidence: { where: { kind: "PHOTO" } } } } } },
      },
    }),
    prisma.driverCustody.groupBy({ by: ["driverId"], where: { startedAt: inPeriod, how: { not: "inicial" } }, _count: { _all: true } }),
    prisma.driverCustody.groupBy({ by: ["driverId", "endReason"], where: { endedAt: inPeriod }, _count: { _all: true } }),
  ]);

  type Row = { id: string; name: string; active: boolean; open: number; flagged: number; old: number; received: number; delivered: number; returned: number; moved: number };
  const rows = new Map<string, Row>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const d = drivers.find((x) => x.id === id);
      r = { id, name: d?.user.name ?? "—", active: d?.user.active ?? false, open: 0, flagged: 0, old: 0, received: 0, delivered: 0, returned: 0, moved: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const c of open) {
    const r = row(c.driverId);
    r.open++;
    if (custodyFlag({ status: c.order.status, mlShipmentId: c.order.mlShipmentId, mlStatus: c.order.mlStatus, photos: c.order._count.evidence })) r.flagged++;
    if (now.getTime() - c.startedAt.getTime() > 86_400_000) r.old++;
  }
  for (const s of started) row(s.driverId).received += s._count._all;
  for (const e of ended) {
    const r = row(e.driverId);
    if (e.endReason === "DELIVERED") r.delivered += e._count._all;
    else if (e.endReason === "RETURNED") r.returned += e._count._all;
    else r.moved += e._count._all;
  }
  const list = [...rows.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const tot = list.reduce((t, r) => ({ open: t.open + r.open, flagged: t.flagged + r.flagged, old: t.old + r.old }), { open: 0, flagged: 0, old: 0 });
  const qs = `desde=${p.desde}&hasta=${p.hasta}`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader eyebrow="Operación" title="Inventario por repartidor">
        Paquetes que cada repartidor debe traer físicamente. Solo salen si quedan entregados en ML y con foto en la app, o si un admin o despachador
        los recibe de vuelta en <Link href="/admin/devoluciones" className="underline">Devoluciones</Link>. Cada movimiento queda en el historial del pedido.
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="En poder de repartidores" value={tot.open} />
        <Stat label="Con pendiente" value={tot.flagged} hint="Entregado sin confirmar, sin foto o por regresar" tone="amber" />
        <Stat label="Más de 24 h" value={tot.old} tone="red" />
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <label className="text-xs text-slate-500">
          Desde
          <input type="date" name="desde" defaultValue={p.desde} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-500">
          Hasta
          <input type="date" name="hasta" defaultValue={p.hasta} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button className="rounded-lg bg-brand px-4 py-2 text-white">Ver periodo</button>
        <p className="w-full text-xs text-slate-500">«En su poder» es al momento; las demás columnas cuentan movimientos del periodo.</p>
      </form>

      <Table head={["Repartidor", "En su poder", "Con pendiente", "Recibidos", "Entregados", "Devueltos", "Traspasos / quitados"]} empty={list.length ? undefined : "Aún no hay movimientos de inventario."}>
        {list.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50">
            <Td>
              <Link href={`/admin/inventario/${r.id}?${qs}`} className="font-medium text-brand underline-offset-2 hover:underline">{r.name}</Link>
              {!r.active && <span className="ml-2 text-xs text-slate-400">inactivo</span>}
            </Td>
            <Td className="font-semibold tabular-nums">{r.open}</Td>
            <Td className={`tabular-nums ${r.flagged ? "font-semibold text-amber-700" : "text-slate-400"}`}>{r.flagged}</Td>
            <Td className="tabular-nums">{r.received}</Td>
            <Td className="tabular-nums">{r.delivered}</Td>
            <Td className="tabular-nums">{r.returned}</Td>
            <Td className="tabular-nums text-slate-500">{r.moved}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
