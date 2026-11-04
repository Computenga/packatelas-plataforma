import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type OrderStatus } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha, soloFecha } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import { Stat } from "@/components/stat";

export const metadata: Metadata = { title: "Devoluciones" };

const PENDING: OrderStatus[] = ["RETURNING", "RETURNED_TO_WAREHOUSE"];
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

/** Paquetes no entregados que regresan a la tienda, con motivo y evidencia [C07]. */
export default async function DevolucionesClientePage({ searchParams }: PageProps<"/cliente/devoluciones">) {
  const { clientId } = await requireClient();
  const tab = (await searchParams).tab === "entregadas" ? "entregadas" : "pendientes";
  const select = {
    id: true, code: true, status: true, recipientName: true, addressLine: true, attempts: true, updatedAt: true,
    return: { select: { receivedAt: true, returnedAt: true } },
    events: { where: { type: "failed" }, orderBy: { occurredAt: "desc" as const }, take: 1, select: { note: true, occurredAt: true, evidence: { select: { id: true, storageKey: true } } } },
  };
  const [pendingCount, inWarehouse, returned30, rows, dvs] = await Promise.all([
    prisma.order.count({ where: { clientId, status: { in: PENDING } } }),
    prisma.order.count({ where: { clientId, status: "RETURNED_TO_WAREHOUSE" } }),
    prisma.order.count({ where: { clientId, status: "RETURNED_TO_SELLER", updatedAt: { gte: daysAgo(30) } } }),
    prisma.order.findMany({
      where: { clientId, status: tab === "pendientes" ? { in: PENDING } : "RETURNED_TO_SELLER" },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select,
    }),
    prisma.order.findMany({
      where: { clientId, kind: "RETURN", status: { not: "CANCELLED" }, createdAt: { gte: daysAgo(60) } },
      select: { id: true, code: true, status: true, deliveredAt: true, createdAt: true, driver: { select: { user: { select: { name: true } } } }, returnItems: { select: { code: true }, orderBy: { code: "asc" } }, evidence: { select: { receiverName: true }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">Devoluciones</h1>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Por devolverte" value={pendingCount} tone="amber" />
        <Stat label="Listas en almacén" value={inWarehouse} hint="Te las llevamos en una orden de devolución" />
        <Stat label="Devueltas (30 días)" value={returned30} tone="green" />
      </div>
      {dvs.length > 0 && (
        <Card title="Órdenes de devolución">
          <ul className="divide-y divide-slate-100 text-sm">
            {dvs.map((d) => (
              <li key={d.id} className="py-2">
                <p>
                  <span className="font-mono font-semibold">{d.code}</span> · {d.returnItems.length} paquete(s) ·{" "}
                  {d.status === "DELIVERED" ? <Badge tone="green">Entregada {d.deliveredAt ? fecha(d.deliveredAt) : ""}</Badge> : d.status === "OUT_FOR_DELIVERY" || d.status === "ASSIGNED" ? <Badge tone="blue">En camino{d.driver ? ` · ${d.driver.user.name}` : ""}</Badge> : <Badge tone="amber">Programada</Badge>}
                  {d.evidence[0]?.receiverName && <span className="text-xs text-slate-500"> · Recibió {d.evidence[0].receiverName}</span>}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-500">{d.returnItems.map((r) => r.code).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        {(["pendientes", "entregadas"] as const).map((t) => (
          <Link key={t} href={t === "pendientes" ? "/cliente/devoluciones" : "/cliente/devoluciones?tab=entregadas"}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 ${tab === t ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600"}`}>
            {t === "pendientes" ? "Pendientes" : "Ya devueltas"}
          </Link>
        ))}
      </nav>
      {rows.length === 0 && <Card><p className="text-sm text-slate-500">{tab === "pendientes" ? "No tienes devoluciones pendientes." : "Aún no hay devoluciones entregadas."}</p></Card>}
      <ul className="space-y-3">
        {rows.map((o) => {
          const fail = o.events[0];
          return (
            <li key={o.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/cliente/envio/${o.id}`} className="font-mono text-sm font-semibold text-brand">{o.code}</Link>
                <Badge tone={o.status === "RETURNED_TO_SELLER" ? "green" : o.status === "RETURNED_TO_WAREHOUSE" ? "blue" : "amber"}>
                  {o.status === "RETURNED_TO_SELLER" ? `Devuelto ${soloFecha(o.return?.returnedAt ?? o.updatedAt)}` : o.status === "RETURNED_TO_WAREHOUSE" ? "En almacén Packatelas" : "Regresando al almacén"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-700">{o.recipientName ?? "—"} · {o.addressLine}</p>
              {fail && (
                <p className="mt-1 text-sm text-slate-600">
                  Motivo: {fail.note ?? "—"} <span className="text-xs text-slate-400">({fecha(fail.occurredAt)} · {o.attempts} intento(s))</span>
                </p>
              )}
              {fail?.evidence.length ? (
                <div className="mt-2 flex gap-2">
                  {fail.evidence.map((ev) => (
                    <a key={ev.id} href={`/api/evidence/${ev.storageKey}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/evidence/${ev.storageKey}`} alt="Evidencia del intento" className="h-20 w-20 rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
