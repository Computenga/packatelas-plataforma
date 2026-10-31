import Link from "next/link";
import { FLEX_OPEN_STATUSES, prisma, type Prisma } from "@packatelas/db";
import { fecha } from "@/lib/format";
import { PAGE_SIZE, type OrderFilters } from "@/lib/order-filters";
import { ButtonLink, Table, Td } from "@/components/ui";

const ML_STATUS: Record<string, string> = {
  pending: "Pendiente", handling: "En preparación", ready_to_ship: "Listo para enviar", shipped: "En camino",
  delivered: "Entregado", not_delivered: "No entregado", cancelled: "Cancelado",
};
const ML_SUB: Record<string, string> = { ready_to_print: "sin imprimir", printed: "impresa", ready_for_pickup: "listo para recoger" };

/** Recuperados: envíos Flex de todas las cuentas ML de los clientes que aún no escanea un repartidor nuestro. */
export async function RecuperadosList({ f, clients }: { f: OrderFilters; clients: { id: string; name: string }[] }) {
  const all = f.status === "todos";
  const q = f.q.trim();
  const where: Prisma.MlFlexShipmentWhereInput = {
    logisticType: "self_service",
    orderId: null,
    ...(all ? {} : { mlStatus: { in: FLEX_OPEN_STATUSES } }),
    ...(f.clientId ? { clientId: f.clientId } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(f.from) || /^\d{4}-\d{2}-\d{2}$/.test(f.to)
      ? { mlCreatedAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00-06:00`) } : {}), ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00-06:00`).getTime() + 86_400_000) } : {}) } }
      : {}),
    ...(q
      ? /^\d{10,13}$/.test(q)
        ? { shipmentId: BigInt(q) }
        : { OR: [{ recipientName: { contains: q, mode: "insensitive" } }, { buyerNickname: { contains: q, mode: "insensitive" } }, { addressLine: { contains: q, mode: "insensitive" } }, { zip: q }, { mlAccount: { nickname: { contains: q, mode: "insensitive" } } }] }
      : {}),
  };
  const [rows, total, byStatus] = await Promise.all([
    prisma.mlFlexShipment.findMany({
      where,
      orderBy: [{ mlCreatedAt: "desc" }, { createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { id: true, name: true } }, mlAccount: { select: { nickname: true } } },
    }),
    prisma.mlFlexShipment.count({ where }),
    prisma.mlFlexShipment.groupBy({ by: ["mlStatus"], where: { logisticType: "self_service", orderId: null, mlStatus: { in: FLEX_OPEN_STATUSES } }, _count: { _all: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (page: number, over: Partial<OrderFilters> = {}) => {
    const p = new URLSearchParams({ vista: "recuperados" });
    const g = { ...f, ...over };
    for (const k of ["q", "status", "clientId", "from", "to"] as const) if (g[k]) p.set(k, g[k]);
    if (page > 1) p.set("page", String(page));
    return `/admin/pedidos?${p}`;
  };
  const open = byStatus.reduce((s, x) => s + x._count._all, 0);

  return (
    <>
      <p className="mb-3 text-sm text-slate-600">
        Todos los envíos Flex de las cuentas de MercadoLibre de los clientes que aún no escanea un repartidor de Packatelas. Al escanearlo pasa al histórico.
        {" "}<strong>{open.toLocaleString("es-MX")}</strong> abiertos
        {byStatus.length > 0 && ` (${byStatus.map((b) => `${ML_STATUS[b.mlStatus ?? ""] ?? b.mlStatus} ${b._count._all}`).join(" · ")})`}.
      </p>
      <form className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm md:grid-cols-6 [&>*]:min-w-0 [&_input]:min-w-0">
        <input type="hidden" name="vista" value="recuperados" />
        <input name="q" defaultValue={f.q} placeholder="Envío, destinatario, comprador, cuenta, CP" className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2" />
        <select name="status" defaultValue={all ? "todos" : ""} className="rounded-lg border border-slate-300 px-3 py-2">
          <option value="">Abiertos en ML</option>
          <option value="todos">Todos (incluye entregados/cancelados)</option>
        </select>
        <select name="clientId" defaultValue={f.clientId} className="rounded-lg border border-slate-300 px-3 py-2">
          <option value="">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="flex gap-2 md:col-span-2">
          <input type="date" name="from" defaultValue={f.from} className="w-full rounded-lg border border-slate-300 px-2 py-2" aria-label="Compra desde" />
          <input type="date" name="to" defaultValue={f.to} className="w-full rounded-lg border border-slate-300 px-2 py-2" aria-label="Compra hasta" />
          <button className="rounded-lg bg-brand px-4 text-white">Filtrar</button>
        </div>
      </form>

      <Table head={["Compra", "Envío", "Estado ML", "Cliente · cuenta", "Destinatario", "Dirección", "Guía"]} empty={rows.length ? undefined : "Sin envíos Flex pendientes con estos filtros"}>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50">
            <Td className="text-slate-600">{fecha(r.mlCreatedAt ?? r.createdAt)}</Td>
            <Td className="font-mono text-xs">{r.shipmentId.toString()}</Td>
            <Td>
              {ML_STATUS[r.mlStatus ?? ""] ?? r.mlStatus ?? "—"}
              {r.mlSubstatus && <span className="block text-xs text-slate-500">{ML_SUB[r.mlSubstatus] ?? r.mlSubstatus}</span>}
            </Td>
            <Td>
              <Link href={`/admin/clientes/${r.client.id}`} className="hover:underline">{r.client.name}</Link>
              <span className="block text-xs text-slate-500">{r.mlAccount.nickname}</span>
            </Td>
            <Td>
              {r.recipientName ?? "—"}
              {r.buyerNickname && <span className="block text-xs text-slate-500">{r.buyerNickname}</span>}
            </Td>
            <Td className="max-w-xs truncate">
              {[r.addressLine, r.neighborhood].filter(Boolean).join(", ") || "—"}
              {r.zip && <span className="block text-xs text-slate-500">CP {r.zip} · {r.city}</span>}
            </Td>
            <Td>
              {r.qrRaw ? (
                <a href={`/guia/${r.shipmentId}`} target="_blank" rel="noopener" className="text-brand hover:underline">Reimprimir</a>
              ) : (
                <span className="text-xs text-slate-500">Se habilita al escanear la etiqueta</span>
              )}
            </Td>
          </tr>
        ))}
      </Table>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">Página {f.page} de {pages} · {total.toLocaleString("es-MX")} envíos</span>
          <div className="flex gap-2">
            {f.page > 1 && <ButtonLink variant="secondary" href={qs(f.page - 1)}>Anterior</ButtonLink>}
            {f.page < pages && <ButtonLink variant="secondary" href={qs(f.page + 1)}>Siguiente</ButtonLink>}
          </div>
        </nav>
      )}
    </>
  );
}
