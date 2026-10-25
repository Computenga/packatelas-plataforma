import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { fecha, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { buildWhere, filtersToQuery, PAGE_SIZE, readFilters } from "@/lib/order-filters";
import { Badge, ButtonLink, PageHeader, Table, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Pedidos" };

export default async function PedidosPage({ searchParams }: PageProps<"/admin/pedidos">) {
  const user = await requireUser(STAFF_ROLES);
  const f = readFilters(await searchParams);
  const where = buildWhere(f);

  const [orders, total, clients] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { name: true } }, driver: { include: { user: { select: { name: true } } } } },
    }),
    prisma.order.count({ where }),
    prisma.client.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = filtersToQuery(f, 1);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Trazabilidad"
        title="Pedidos"
        actions={
          <>
            <ButtonLink href={`/admin/pedidos/exportar${qs ? `?${qs}` : ""}`} variant="secondary" prefetch={false}>
              Exportar CSV
            </ButtonLink>
            {user.role !== "DESPACHADOR" && <ButtonLink href="/admin/pedidos/nuevo">Nuevo pedido</ButtonLink>}
          </>
        }
      >
        {total.toLocaleString("es-MX")} pedido(s)
      </PageHeader>

      <form className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm md:grid-cols-6">
        <input name="q" defaultValue={f.q} placeholder="Envío, pedido, destinatario, dirección, CP" className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2" />
        <select name="status" defaultValue={f.status} className="rounded-lg border border-slate-300 px-3 py-2">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
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

      <Table head={["Registrado", "Envío", "Estado", "Cliente", "Destinatario", "Dirección", "Repartidor"]} empty={orders.length ? undefined : "Sin pedidos con estos filtros"}>
        {orders.map((o) => (
          <tr key={o.id} className="hover:bg-slate-50">
            <Td className="text-slate-600">{fecha(o.createdAt)}</Td>
            <Td>
              <Link href={`/admin/pedidos/${o.id}`} className="font-mono text-xs font-medium text-brand hover:underline">
                {o.code}
              </Link>
            </Td>
            <Td><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></Td>
            <Td>{o.client.name}</Td>
            <Td>{o.recipientName ?? "—"}</Td>
            <Td className="max-w-xs truncate">{[o.addressLine, o.neighborhood, o.city].filter(Boolean).join(", ")}</Td>
            <Td>{o.driver?.user.name ?? "—"}</Td>
          </tr>
        ))}
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
    </div>
  );
}
