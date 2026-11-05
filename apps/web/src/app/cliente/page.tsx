import type { Metadata } from "next";
import Link from "next/link";
import type { OrderStatus, Prisma } from "@packatelas/db";
import { getClientBalance, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { buildWhere, filtersToQuery, PAGE_SIZE, readFilters } from "@/lib/order-filters";
import { publicTrackingUrl } from "@/lib/tracking";
import { ClientOnboarding } from "@/components/client-onboarding";
import { ClientTour } from "@/components/client-tour";
import { ShipmentTable, type ShipmentRow } from "./shipment-table";

export const metadata: Metadata = { title: "Mis envíos" };

// Pestañas por estado, como Moova («En curso», «Historial»): lo que la tienda revisa a diario.
const VIEWS: { key: string; label: string; where: () => Prisma.OrderWhereInput; alert?: boolean }[] = [
  { key: "salir", label: "Por salir", where: () => ({ status: "CREATED" }) },
  { key: "camino", label: "En camino", where: () => ({ status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] as OrderStatus[] } }) },
  { key: "hoy", label: "Entregados hoy", where: () => ({ status: "DELIVERED", deliveredAt: { gte: startOfDayMx() } }) },
  { key: "problema", label: "Con problema", alert: true, where: () => ({ status: { in: ["FAILED", "RESCHEDULED", "RETURNING", "RETURNED_TO_WAREHOUSE"] as OrderStatus[] } }) },
  { key: "todos", label: "Todos", where: () => ({}) },
];

function startOfDayMx() {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  return new Date(`${ymd}T00:00:00-06:00`);
}

const HM = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "numeric", minute: "2-digit" });
const DM = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const when = (d: Date) => (d >= startOfDayMx() ? HM.format(d) : DM.format(d));

export default async function ClienteHome({ searchParams }: PageProps<"/cliente">) {
  const user = await requireUser(["CLIENTE"]);
  if (!user.clientId) {
    return <p className="text-slate-600">Tu usuario aún no está ligado a una cuenta de cliente. Contacta a Packatelas.</p>;
  }
  const clientId = user.clientId;
  const sp = await searchParams;
  const f = readFilters(sp);
  const searching = !!f.q;
  const view = VIEWS.find((v) => v.key === sp.vista) ?? (searching ? VIEWS[4] : VIEWS[1]);
  const base = { clientId, kind: "DELIVERY" as const };
  const where: Prisma.OrderWhereInput = { ...buildWhere(f, clientId), ...view.where(), kind: "DELIVERY" }; // siempre restringido a su propio cliente

  const tourDone = (await prisma.user.findUnique({ where: { id: user.id }, select: { tourSeenAt: true } }))?.tourSeenAt;
  const [client, counts, balance, orders, total] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } }),
    Promise.all(VIEWS.slice(0, 4).map((v) => prisma.order.count({ where: { ...base, ...v.where() } }))),
    getClientBalance(prisma, clientId),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { driver: { select: { user: { select: { name: true } } } } },
    }),
    prisma.order.count({ where }),
  ]);
  const last = await prisma.orderEvent.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    orderBy: { occurredAt: "desc" },
    distinct: ["orderId"],
    select: { orderId: true, type: true, note: true, toStatus: true, occurredAt: true },
  });
  const lastBy = new Map(last.map((e) => [e.orderId, e]));
  const rows: ShipmentRow[] = orders.map((o) => {
    const e = lastBy.get(o.id);
    return {
      id: o.id,
      code: o.code,
      sale: o.mlOrderId ? `Venta ${o.mlOrderId}` : o.mlShipmentId ? "Mercado Libre" : "Envío propio",
      own: !o.mlShipmentId,
      recipient: o.recipientName ?? "—",
      where: [o.neighborhood, o.city].filter(Boolean).join(", ") || (o.addressLine ?? ""),
      status: STATUS_LABEL[o.status],
      tone: o.attempts > 0 && o.status !== "DELIVERED" ? "amber" : STATUS_TONE[o.status],
      attempts: o.attempts,
      lastText: e ? (e.note || (e.toStatus ? STATUS_LABEL[e.toStatus] : e.type === "created" ? "Registrado" : "Actualizado")) : "Registrado",
      lastAt: when(e?.occurredAt ?? o.createdAt),
      driver: o.driver?.user.name.split(/\s+/).slice(0, 2).join(" ") ?? null,
      tracking: publicTrackingUrl(o.id),
    };
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keep = (extra: Record<string, string | number>) => {
    const q = new URLSearchParams(filtersToQuery(f, 1));
    q.set("vista", view.key);
    for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
    return `/cliente?${q}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <ClientOnboarding clientId={clientId} />
      <div className="text-right">
        <ClientTour open={!tourDone} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{client.name}</p>
          <h1>Mis envíos</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm font-semibold">
          <Link href="/cliente/recolecciones" className="rounded-lg border-[1.5px] border-brand bg-white px-3 py-2">Pedir recolección</Link>
          <Link href="/cliente/carga" className="rounded-lg border-[1.5px] border-brand bg-white px-3 py-2">Cargar varios</Link>
          <Link href="/cliente/nuevo" className="rounded-lg bg-accent px-3 py-2 font-bold text-brand">Nuevo envío</Link>
        </div>
      </div>

      {balance.gt(0) && (
        <Link href="/cliente/cuenta" className="flex items-center justify-between rounded-xl bg-brand px-4 py-3 text-white">
          <span>Saldo por pagar <b className="ml-1 font-display text-2xl font-black text-accent">{mxn(balance)}</b></span>
          <span className="text-sm font-semibold underline">Pagar</span>
        </Link>
      )}

      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b-2 border-slate-200 px-1 text-sm" aria-label="Estado">
        {VIEWS.map((v, i) => {
          const on = v.key === view.key;
          const n = counts[i];
          return (
            <Link
              key={v.key}
              href={`/cliente?vista=${v.key}${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`}
              className={`-mb-0.5 whitespace-nowrap px-3 py-2 font-semibold ${on ? "border-b-[3px] border-accent text-brand" : "text-slate-500"}`}
            >
              {v.label}
              {n !== undefined && <b className={`ml-1.5 ${v.alert && n > 0 ? "text-red-600" : "text-brand"}`}>{n}</b>}
            </Link>
          );
        })}
      </nav>

      <form className="flex gap-2 text-sm">
        <input type="hidden" name="vista" value={view.key} />
        <input name="q" defaultValue={f.q} placeholder="Buscar por folio, venta de Mercado Libre, destinatario, colonia o CP" className="min-w-0 flex-1 rounded-lg border-[1.5px] border-slate-200 bg-white px-3 py-2.5" />
        <button className="rounded-lg bg-brand px-4 py-2 font-semibold text-white">Buscar</button>
      </form>

      <ShipmentTable rows={rows} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">{total.toLocaleString("es-MX")} envío(s){pages > 1 ? ` · página ${f.page} de ${pages}` : ""}</span>
        <span className="flex gap-4">
          {f.page > 1 && <Link className="font-semibold text-brand" href={keep({ page: f.page - 1 })}>Anterior</Link>}
          {f.page < pages && <Link className="font-semibold text-brand" href={keep({ page: f.page + 1 })}>Siguiente</Link>}
          <a href={`/cliente/exportar?${new URLSearchParams(filtersToQuery(f, 1))}`} className="font-semibold text-brand">Descargar todo en CSV</a>
        </span>
      </div>
    </div>
  );
}
