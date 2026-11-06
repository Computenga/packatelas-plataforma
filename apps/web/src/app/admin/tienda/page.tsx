import type { Metadata } from "next";
import Link from "next/link";
import { prisma, storeFolio, STORE_STATUS, WOO_STORE_URL, type StoreItem } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { PriceForm } from "./price-form";
import { bulkVisibleAction, readyAction, setPortalPriceAction, syncCatalogAction, toggleProductAction } from "./actions";

export const metadata: Metadata = { title: "Tienda" };
const DIA = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** Tienda de insumos [P17]: pedidos por preparar y catálogo (copiado de WooCommerce). */
export default async function TiendaAdminPage({ searchParams }: PageProps<"/admin/tienda">) {
  const user = await requireUser(["ADMIN", "DESPACHADOR", "OPERADOR"]);
  const all = (await searchParams).ver === "todos";
  const [orders, products, sums] = await Promise.all([
    prisma.storeOrder.findMany({
      where: all ? { status: { not: "PENDING_PAYMENT" } } : { status: { in: ["PAID", "READY"] } },
      orderBy: { createdAt: all ? "desc" : "asc" },
      take: 200,
      include: { client: { select: { id: true, name: true, publicId: true } }, pickup: { select: { scheduledFor: true, status: true, order: { select: { id: true, code: true } } } } },
    }),
    user.role === "ADMIN" ? prisma.storeProduct.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }) : Promise.resolve([]),
    prisma.storeOrder.aggregate({ where: { status: { in: ["PAID", "READY", "DELIVERED"] }, paidAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { total: true }, _count: true }),
  ]);
  // Total por producto de lo que hay que preparar.
  const pick = new Map<string, number>();
  for (const o of orders) if (o.status === "PAID") for (const i of o.items as unknown as StoreItem[]) pick.set(i.name, (pick.get(i.name) ?? 0) + i.qty);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Tiendas" title="Tienda de insumos" actions={<Link href={all ? "?" : "?ver=todos"} className="text-sm text-brand">{all ? "Solo por entregar" : "Ver todos"}</Link>}>
        Las tiendas compran desde su portal y pagan con saldo a favor o tarjeta. El repartidor lo lleva en su recolección; al recolectar queda entregado.
        Últimos 30 días: {sums._count} pedidos · {mxn(sums._sum.total ?? 0)}.
      </PageHeader>

      {pick.size > 0 && (
        <Card title="Por preparar (todo junto)">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {[...pick.entries()].map(([n, q]) => <li key={n}><strong>{q}×</strong> {n}</li>)}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Recuerda descontar el inventario en WooCommerce si llevas existencias ahí.</p>
        </Card>
      )}

      <Table head={["Pedido", "Tienda", "Artículos", "Total", "Pago", "Entrega", "Estado"]} empty={orders.length ? undefined : "No hay pedidos por entregar"}>
        {orders.map((o) => {
          const [label, tone] = STORE_STATUS[o.status];
          return (
            <tr key={o.id} className="align-top">
              <Td className="font-mono text-xs">{storeFolio(o.number)}<span className="block text-slate-400">{fecha(o.createdAt)}</span></Td>
              <Td><Link href={`/admin/clientes/${o.client.id}`} className="text-brand hover:underline">{o.client.name}</Link></Td>
              <Td className="whitespace-normal text-xs">{(o.items as unknown as StoreItem[]).map((i) => <span key={i.productId} className="block">{i.qty}× {i.name}</span>)}</Td>
              <Td>{mxn(o.total)}</Td>
              <Td className="text-xs">{o.payMethod === "SALDO" ? "Saldo a favor" : "Tarjeta"}</Td>
              <Td className="text-xs">
                {o.pickup ? (
                  <>
                    {DIA.format(o.pickup.scheduledFor)}
                    {o.pickup.order && <Link href={`/admin/pedidos/${o.pickup.order.id}`} className="block font-mono text-brand">{o.pickup.order.code}</Link>}
                  </>
                ) : "Sin recolección"}
              </Td>
              <Td>
                <Badge tone={tone}>{label}</Badge>
                {o.status === "PAID" && (
                  <form action={readyAction.bind(null, o.id)} className="mt-1"><button className="text-xs text-brand underline">Marcar preparado</button></form>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>

      {user.role === "ADMIN" && (
        <Card title={`Catálogo (${products.filter((p) => p.active && p.inStock).length} visibles en el portal de ${products.length})`} actions={<ActionForm action={syncCatalogAction} submitLabel="Actualizar desde WooCommerce"><span /></ActionForm>}>
          <p className="mb-3 text-sm text-slate-600">
            Nombre, fotos, existencias y precio base se copian solos cada hora de <a href={WOO_STORE_URL} target="_blank" rel="noreferrer" className="text-brand underline">{WOO_STORE_URL.replace(/^https?:\/\//, "")}</a>.
            Aquí eliges qué productos ven las tiendas y, si quieres, un precio distinto para el portal (vacío = el de WooCommerce).
          </p>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <form action={bulkVisibleAction.bind(null, true, null)}><button className="rounded border border-slate-300 px-2 py-1">Mostrar todos</button></form>
            <form action={bulkVisibleAction.bind(null, false, null)}><button className="rounded border border-slate-300 px-2 py-1">Ocultar todos</button></form>
          </div>
          {[...new Set(products.map((p) => p.category))].map((cat) => {
            const list = products.filter((p) => p.category === cat);
            return (
              <div key={cat} className="mb-4">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1">
                  <h3 className="font-semibold">{cat}</h3>
                  <span className="text-xs text-slate-500">{list.filter((p) => p.active).length}/{list.length} visibles</span>
                  <form action={bulkVisibleAction.bind(null, true, cat)}><button className="text-xs text-brand hover:underline">Mostrar todos</button></form>
                  <form action={bulkVisibleAction.bind(null, false, cat)}><button className="text-xs text-brand hover:underline">Ocultar todos</button></form>
                </div>
                <ul className="divide-y divide-slate-100 text-sm">
                  {list.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                      <form action={toggleProductAction.bind(null, p.id)}>
                        <button
                          role="switch"
                          aria-checked={p.active}
                          aria-label={p.active ? `Ocultar ${p.name}` : `Mostrar ${p.name}`}
                          className={`w-24 rounded-md px-2 py-1 text-xs font-semibold ${p.active ? "bg-[#E5F5EC] text-[#168A4D]" : "bg-slate-100 text-slate-500"}`}
                        >
                          {p.active ? "✓ Visible" : "Oculto"}
                        </button>
                      </form>
                      <span className={`min-w-0 flex-1 ${p.active && p.inStock ? "" : "text-slate-400"}`}>
                        <span className="block truncate">{p.name}</span>
                        <span className="text-xs">WooCommerce: {mxn(p.price)}{!p.inStock && " · agotado"}</span>
                      </span>
                      <PriceForm action={setPortalPriceAction.bind(null, p.id)} current={p.portalPrice ? Number(p.portalPrice).toFixed(2) : ""} woo={Number(p.price).toFixed(2)} />
                      {p.portalPrice && <Badge tone="blue">Precio propio</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
