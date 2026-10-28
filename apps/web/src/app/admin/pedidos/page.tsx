import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type OrderStatus } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { fecha, hace, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { buildWhere, filtersToQuery, LIVE_STATUSES, PAGE_SIZE, readFilters, type OrderFilters } from "@/lib/order-filters";
import { RecuperadosList } from "./recuperados";
import { Badge, ButtonLink, PageHeader, Table, Td } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Pedidos" };

const VIEWS = [
  { key: "", label: "Histórico" },
  { key: "vivo", label: "En vivo" },
  { key: "recuperados", label: "Recuperados" },
] as const;

/** Más de un día sin entregarse: se resalta en En vivo. */
const STALE_MS = 24 * 3600_000;
/** Hora de la consulta (fuera del componente: la página se arma una vez por petición). */
const requestTime = () => Date.now();

export default async function PedidosPage({ searchParams }: PageProps<"/admin/pedidos">) {
  const user = await requireUser(STAFF_ROLES);
  const f = readFilters(await searchParams);
  const where = buildWhere(f);
  const live = f.view === "vivo";
  const recovered = f.view === "recuperados";

  const [orders, total, clients, liveCounts] = await Promise.all([
    recovered ? Promise.resolve([]) : prisma.order.findMany({
      where,
      orderBy: live ? { createdAt: "asc" } : { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        client: { select: { name: true } },
        driver: { include: { user: { select: { name: true } } } },
        events: live ? { where: { toStatus: { not: null } }, orderBy: { occurredAt: "desc" }, take: 1 } : false,
      },
    }),
    recovered ? Promise.resolve(0) : prisma.order.count({ where }),
    prisma.client.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    live
      ? prisma.order.groupBy({ by: ["status"], where: buildWhere({ ...f, status: "" }), _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = filtersToQuery(f, 1);
  const now = requestTime();
  const statusOptions = (live ? LIVE_STATUSES : f.view ? [] : (Object.keys(STATUS_LABEL) as OrderStatus[]));
  const tabHref = (view: OrderFilters["view"]) => {
    const q = filtersToQuery({ ...f, view, status: "", page: 1 });
    return `/admin/pedidos${q ? `?${q}` : ""}`;
  };

  const head = live
    ? ["Antigüedad", "Envío", "Estado", "Último movimiento", "Cliente", "Dirección", "Repartidor"]
    : ["Registrado", "Envío", "Estado", "Cliente", "Destinatario", "Dirección", "Repartidor"];

  return (
    <div className="mx-auto max-w-7xl">
      {live && <AutoRefresh seconds={60} />}
      <PageHeader
        eyebrow="Trazabilidad"
        title="Pedidos"
        actions={
          <>
            <ButtonLink href={`/admin/pedidos/exportar${qs ? `?${qs}` : ""}`} variant="secondary" prefetch={false}>
              Exportar CSV
            </ButtonLink>
            {user.role !== "DESPACHADOR" && (
              <>
                <ButtonLink href="/admin/pedidos/carga" variant="secondary">Carga masiva</ButtonLink>
                <ButtonLink href="/admin/pedidos/nuevo">Nuevo pedido</ButtonLink>
              </>
            )}
          </>
        }
      >
        {recovered ? "Envíos Flex de MercadoLibre por recoger" : <>{total.toLocaleString("es-MX")} pedido(s)</>}
        {live && " sin cerrar · se actualiza cada minuto"}
      </PageHeader>

      <nav className="mb-4 flex gap-1 border-b border-slate-200 text-sm" aria-label="Vistas">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={tabHref(v.key)}
            aria-current={f.view === v.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${f.view === v.key ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {recovered && <RecuperadosList f={f} clients={clients} />}

      {!recovered && (
        <>
      {live && liveCounts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {LIVE_STATUSES.map((s) => {
            const n = liveCounts.find((c) => c.status === s)?._count._all ?? 0;
            if (!n) return null;
            const q = filtersToQuery({ ...f, status: f.status === s ? "" : s, page: 1 });
            return (
              <Link key={s} href={`/admin/pedidos?${q}`} className={`rounded-lg border px-3 py-1.5 ${f.status === s ? "border-brand bg-brand/5" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                {STATUS_LABEL[s]} <span className="font-semibold">{n}</span>
              </Link>
            );
          })}
        </div>
      )}

      <form className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm md:grid-cols-6">
        {f.view && <input type="hidden" name="vista" value={f.view} />}
        <input name="q" defaultValue={f.q} placeholder="Envío, pedido, destinatario, dirección, CP" className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2" />
        <select name="status" defaultValue={f.status} disabled={!statusOptions.length} className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50">
          <option value="">Todos los estados</option>
          {statusOptions.map((k) => (
            <option key={k} value={k}>{STATUS_LABEL[k]}</option>
          ))}
        </select>
        <select name="clientId" defaultValue={f.clientId} className="rounded-lg border border-slate-300 px-3 py-2">
          <option value="">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="flex gap-2 md:col-span-2">
          <input type="date" name="from" defaultValue={f.from} className="w-full rounded-lg border border-slate-300 px-2 py-2" aria-label="Desde" />
          <input type="date" name="to" defaultValue={f.to} className="w-full rounded-lg border border-slate-300 px-2 py-2" aria-label="Hasta" />
          <button className="rounded-lg bg-brand px-4 text-white">Filtrar</button>
        </div>
      </form>

      <Table head={head} empty={orders.length ? undefined : live ? "No hay pedidos abiertos" : "Sin pedidos con estos filtros"}>
        {orders.map((o) => {
          const ev = o.events?.[0];
          const code = (
            <Td>
              <Link href={`/admin/pedidos/${o.id}`} className="font-mono text-xs font-medium text-brand hover:underline">
                {o.code}
              </Link>
            </Td>
          );
          const driver = <Td>{o.driver?.user.name ?? "—"}</Td>;
          if (live) {
            const stale = now - o.createdAt.getTime() > STALE_MS;
            return (
              <tr key={o.id} className={stale ? "bg-amber-50/60" : "hover:bg-slate-50"}>
                <Td className={stale ? "font-semibold text-amber-800" : "text-slate-600"}>
                  <span title={fecha(o.createdAt)}>{hace(o.createdAt, now)}</span>
                </Td>
                {code}
                <Td><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></Td>
                <Td className="text-slate-600">
                  {ev ? <span title={fecha(ev.occurredAt)}>hace {hace(ev.occurredAt, now)}{ev.note ? ` · ${ev.note}` : ""}</span> : "—"}
                </Td>
                <Td>{o.client.name}</Td>
                <Td className="max-w-xs truncate">{[o.addressLine, o.neighborhood, o.city].filter(Boolean).join(", ")}</Td>
                {driver}
              </tr>
            );
          }
          return (
            <tr key={o.id} className="hover:bg-slate-50">
              <Td className="text-slate-600">{fecha(o.createdAt)}</Td>
              {code}
              <Td><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></Td>
              <Td>{o.client.name}</Td>
              <Td>{o.recipientName ?? "—"}</Td>
              <Td className="max-w-xs truncate">{[o.addressLine, o.neighborhood, o.city].filter(Boolean).join(", ")}</Td>
              {driver}
            </tr>
          );
        })}
      </Table>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">Página {f.page} de {pages}</span>
          <div className="flex gap-2">
            {f.page > 1 && <ButtonLink variant="secondary" href={`/admin/pedidos?${filtersToQuery(f, f.page - 1)}`}>Anterior</ButtonLink>}
            {f.page < pages && <ButtonLink variant="secondary" href={`/admin/pedidos?${filtersToQuery(f, f.page + 1)}`}>Siguiente</ButtonLink>}
          </div>
        </nav>
      )}
        </>
      )}
    </div>
  );
}