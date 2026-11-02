import type { Metadata } from "next";
import Link from "next/link";
import { prisma, storeFolio, STORE_STATUS, WOO_STORE_URL, type StoreItem } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { readyAction, syncCatalogAction, toggleProductAction } from "./actions";

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
        <Card title={`Catálogo (${products.filter((p) => p.active && p.inStock).length} a la venta)`} actions={<ActionForm action={syncCatalogAction} submitLabel="Actualizar desde WooCommerce"><span /></ActionForm>}>
          <p className="mb-3 text-sm text-slate-600">
            Productos, precios, fotos y existencias se copian solos cada hora de <a href={WOO_STORE_URL} target="_blank" rel="noreferrer" className="text-brand underline">{WOO_STORE_URL.replace(/^https?:\/\//, "")}</a>. Para cambiar algo, hazlo en WooCommerce. Aquí solo puedes ocultar un producto del portal.
          </p>
          <ul className="divide-y divide-slate-100 text-sm">
            {products.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className={`min-w-0 ${p.active && p.inStock ? "" : "text-slate-400"}`}>
                  <span className="block truncate">{p.name}</span>
                  <span className="text-xs">{p.category} · {mxn(p.price)}{!p.inStock && " · agotado"}</span>
                </span>
                <form action={toggleProductAction.bind(null, p.id)}>
                  <button className="rounded border border-slate-300 px-2 py-1 text-xs">{p.active ? "Ocultar" : "Mostrar"}</button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
