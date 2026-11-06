import type { Metadata } from "next";
import Link from "next/link";
import { onSale, prisma, storeCover, storeFolio, storePrice, STORE_STATUS, type StoreItem } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn, STATUS_LABEL } from "@/lib/format";
import { Badge, ButtonLink, Card, PageHeader, Table, Td } from "@/components/ui";
import { AssignSelect } from "../pedidos/assign-select";
import { bulkVisibleAction, readyAction, toggleProductAction } from "./actions";

export const metadata: Metadata = { title: "Tienda" };
const DIA = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** Tienda de insumos [P17]: compras por entregar (pedidos IN- asignables) y catálogo propio. */
export default async function TiendaAdminPage({ searchParams }: PageProps<"/admin/tienda">) {
  const user = await requireUser(["ADMIN", "DESPACHADOR", "OPERADOR"]);
  const sp = await searchParams;
  const all = sp.ver === "todos";
  const canAssign = user.role === "ADMIN" || user.role === "DESPACHADOR";
  const [orders, products, sums, drivers] = await Promise.all([
    prisma.storeOrder.findMany({
      where: all ? { status: { not: "PENDING_PAYMENT" } } : { status: { in: ["PAID", "READY"] } },
      orderBy: { createdAt: all ? "desc" : "asc" },
      take: 200,
      include: {
        client: { select: { id: true, name: true } },
        pickup: { select: { scheduledFor: true, order: { select: { id: true, code: true } } } },
        order: { select: { id: true, code: true, status: true, driverId: true, driver: { select: { user: { select: { name: true } } } } } },
      },
    }),
    user.role === "ADMIN" ? prisma.storeProduct.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }) : Promise.resolve([]),
    prisma.storeOrder.aggregate({ where: { status: { in: ["PAID", "READY", "DELIVERED"] }, paidAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { total: true }, _count: true }),
    canAssign ? prisma.driver.findMany({ where: { active: true, user: { active: true } }, select: { id: true, onDuty: true, user: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const driverOpts = drivers.map((d) => ({ id: d.id, name: d.user.name, onDuty: d.onDuty })).sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || a.name.localeCompare(b.name, "es"));
  const pick = new Map<string, number>();
  for (const o of orders) if (o.status === "PAID") for (const i of o.items as unknown as StoreItem[]) pick.set(i.name, (pick.get(i.name) ?? 0) + i.qty);
  const visible = products.filter((p) => p.active && p.stock > 0).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Tiendas" title="Tienda de insumos" actions={<Link href={all ? "?" : "?ver=todos"} className="text-sm text-brand">{all ? "Solo por entregar" : "Ver todas las compras"}</Link>}>
        Las tiendas compran desde su portal con su saldo a favor o pagando con tarjeta. Cada compra genera un pedido IN- a su dirección que se asigna a un repartidor como cualquier pedido (sin costo de envío).
        Últimos 30 días: {sums._count} compras · {mxn(sums._sum.total ?? 0)}.
      </PageHeader>
      {sp.guardado && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Producto guardado.</p>}

      {pick.size > 0 && (
        <Card title="Por preparar (todo junto)">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {[...pick.entries()].map(([n, q]) => <li key={n}><strong>{q}×</strong> {n}</li>)}
          </ul>
        </Card>
      )}

      <Table head={["Compra", "Tienda", "Artículos", "Total", "Pago", "Repartidor", "Estado"]} empty={orders.length ? undefined : "No hay compras por entregar"}>
        {orders.map((o) => {
          const [label, tone] = STORE_STATUS[o.status];
          const open = o.order && ["CREATED", "ASSIGNED", "RESCHEDULED", "FAILED"].includes(o.order.status);
          return (
            <tr key={o.id} className="align-top">
              <Td className="font-mono text-xs">
                {o.order ? <Link href={`/admin/pedidos/${o.order.id}`} className="font-semibold text-brand hover:underline">{o.order.code}</Link> : storeFolio(o.number)}
                <span className="block text-slate-400">{fecha(o.createdAt)}</span>
              </Td>
              <Td><Link href={`/admin/clientes/${o.client.id}`} className="text-brand hover:underline">{o.client.name}</Link></Td>
              <Td className="whitespace-normal text-xs">{(o.items as unknown as StoreItem[]).map((i) => <span key={i.productId} className="block">{i.qty}× {i.name}</span>)}</Td>
              <Td>{mxn(o.total)}</Td>
              <Td className="text-xs">{o.payMethod === "SALDO" ? "Saldo a favor" : "Tarjeta"}</Td>
              <Td className="text-xs">
                {o.order ? (
                  canAssign && open ? <AssignSelect orderId={o.order.id} current={o.order.driverId} drivers={driverOpts} /> : <>{o.order.driver?.user.name ?? "—"} · {STATUS_LABEL[o.order.status]}</>
                ) : o.pickup ? (
                  <>Con la recolección del {DIA.format(o.pickup.scheduledFor)}{o.pickup.order && <Link href={`/admin/pedidos/${o.pickup.order.id}`} className="block font-mono text-brand">{o.pickup.order.code}</Link>}</>
                ) : "—"}
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
        <Card title={`Catálogo (${visible} a la venta de ${products.length})`} actions={<ButtonLink href="/admin/tienda/producto/nuevo">Nuevo producto</ButtonLink>}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <form action={bulkVisibleAction.bind(null, true, null)}><button className="rounded border border-slate-300 px-2 py-1">Mostrar todos</button></form>
            <form action={bulkVisibleAction.bind(null, false, null)}><button className="rounded border border-slate-300 px-2 py-1">Ocultar todos</button></form>
            <span className="text-slate-500">Solo se venden los visibles con stock.</span>
          </div>
          {products.length === 0 && <p className="text-sm text-slate-500">Aún no hay productos. Da de alta el primero con «Nuevo producto».</p>}
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
                  {list.map((p) => {
                    const cover = storeCover(p);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover} alt="" className="h-12 w-12 rounded border border-slate-200 object-contain" />
                        ) : <span className="h-12 w-12 rounded bg-slate-100" />}
                        <span className={`min-w-0 flex-1 ${p.active && p.stock > 0 ? "" : "text-slate-400"}`}>
                          <Link href={`/admin/tienda/producto/${p.id}`} className="block truncate font-medium hover:underline">{p.name}</Link>
                          <span className="text-xs">
                            {onSale(p) ? <><strong>{mxn(storePrice(p))}</strong> <s>{mxn(p.price)}</s></> : mxn(p.price)}
                            {p.sku && ` · SKU ${p.sku}`} · {p.stock > 0 ? `${p.stock} en stock` : <span className="font-semibold text-red-700">sin stock</span>}
                          </span>
                        </span>
                        <form action={toggleProductAction.bind(null, p.id)}>
                          <button role="switch" aria-checked={p.active} aria-label={p.active ? `Ocultar ${p.name}` : `Mostrar ${p.name}`}
                            className={`w-24 rounded-md px-2 py-1 text-xs font-semibold ${p.active ? "bg-[#E5F5EC] text-[#168A4D]" : "bg-slate-100 text-slate-500"}`}>
                            {p.active ? "✓ Visible" : "Oculto"}
                          </button>
                        </form>
                        <Link href={`/admin/tienda/producto/${p.id}`} className="text-xs text-brand hover:underline">Editar</Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
