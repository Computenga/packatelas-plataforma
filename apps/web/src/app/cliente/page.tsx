import type { Metadata } from "next";
import Link from "next/link";
import { getClientBalance, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { buildWhere, filtersToQuery, PAGE_SIZE, readFilters } from "@/lib/order-filters";
import { Badge } from "@/components/ui";
import { Stat } from "@/components/stat";

export const metadata: Metadata = { title: "Mis envíos" };

export default async function ClienteHome({ searchParams }: PageProps<"/cliente">) {
  const user = await requireUser(["CLIENTE"]);
  if (!user.clientId) {
    return <p className="text-slate-600">Tu usuario aún no está ligado a una cuenta de cliente. Contacta a Packatelas.</p>;
  }
  const clientId = user.clientId;
  const f = readFilters(await searchParams);
  const where = { ...buildWhere(f, clientId), kind: "DELIVERY" as const }; // siempre restringido a su propio cliente

  const [client, inProgress, deliveredCount, balance, orders, total] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, paymentReference: true } }),
    prisma.order.count({ where: { clientId, kind: "DELIVERY", status: { in: ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY"] } } }),
    prisma.order.count({ where: { clientId, kind: "DELIVERY", status: "DELIVERED" } }),
    getClientBalance(prisma, clientId),
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.order.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = filtersToQuery(f, 1);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{client.name}</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/cliente/carga" className="rounded-lg border border-slate-300 bg-white px-3 py-2">Cargar varios</Link>
          <Link href="/cliente/nuevo" className="rounded-lg bg-brand px-3 py-2 font-medium text-white">Nuevo envío</Link>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="En camino" value={inProgress} tone="amber" />
        <Stat label="Entregados" value={deliveredCount} tone="green" />
        <Link href="/cliente/cuenta">
          <Stat label={balance.gt(0) ? "Por pagar" : "A favor"} value={mxn(balance.abs())} tone={balance.gt(0) ? "red" : "green"} hint="Ver estado de cuenta" />
        </Link>
      </div>

      <form className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm sm:grid-cols-4">
        <input name="q" defaultValue={f.q} placeholder="Envío, destinatario, colonia o CP" className="rounded-lg border border-slate-300 px-3 py-2 sm:col-span-2" />
        <select name="status" defaultValue={f.status} className="rounded-lg border border-slate-300 px-3 py-2">
          <option value="">Todos</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="rounded-lg bg-brand px-4 py-2 text-white">Buscar</button>
      </form>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">{total.toLocaleString("es-MX")} envío(s)</span>
        <a href={`/cliente/exportar${qs ? `?${qs}` : ""}`} className="text-brand">Descargar CSV</a>
      </div>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/cliente/envio/${o.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="min-w-0">
                <span className="font-mono text-xs">{o.code}</span>
                <span className="block truncate text-sm">{o.recipientName ?? "—"} · {[o.addressLine, o.neighborhood].filter(Boolean).join(", ")}</span>
                <span className="block text-xs text-slate-500">{fecha(o.createdAt)}</span>
              </span>
              <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
            </Link>
          </li>
        ))}
        {orders.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Sin envíos</li>}
      </ul>

      {pages > 1 && (
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Página {f.page} de {pages}</span>
          <span className="flex gap-3">
            {f.page > 1 && <Link className="text-brand" href={`/cliente?${filtersToQuery(f, f.page - 1)}`}>Anterior</Link>}
            {f.page < pages && <Link className="text-brand" href={`/cliente?${filtersToQuery(f, f.page + 1)}`}>Siguiente</Link>}
          </span>
        </div>
      )}
    </div>
  );
}
