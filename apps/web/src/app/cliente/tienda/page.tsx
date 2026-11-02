import type { Metadata } from "next";
import { earliestPickupDate, getClientBalance, mpConfigured, pickupDayLabel, prisma, storeFolio, STORE_STATUS, type StoreItem } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { mxn } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import { StoreClient } from "./store-client";

export const metadata: Metadata = { title: "Tienda de insumos" };
const DIA = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

export default async function TiendaPage({ searchParams }: PageProps<"/cliente/tienda">) {
  const { clientId } = await requireClient();
  const sp = await searchParams;
  const [products, branches, balance, orders] = await Promise.all([
    prisma.storeProduct.findMany({ where: { active: true, inStock: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.branch.findMany({ where: { clientId, active: true }, select: { id: true, name: true, address: true }, orderBy: { name: "asc" } }),
    getClientBalance(prisma, clientId),
    prisma.storeOrder.findMany({ where: { clientId, status: { not: "PENDING_PAYMENT" } }, orderBy: { createdAt: "desc" }, take: 20, include: { pickup: { select: { scheduledFor: true } } } }),
  ]);
  const next = await prisma.pickup.findFirst({
    where: { clientId, scheduledFor: { gte: new Date(`${earliestPickupDate()}T00:00:00Z`) }, status: { in: ["SCHEDULED", "ASSIGNED"] } },
    orderBy: { scheduledFor: "asc" },
  });
  const deliveryText = next
    ? `Te lo llevamos en tu próxima recolección: ${DIA.format(next.scheduledFor)}.`
    : `Te lo llevamos con la recolección del ${pickupDayLabel(earliestPickupDate())} (la agendamos por ti).`;
  const justOrdered = typeof sp.pedido === "string" ? orders.find((o) => o.id === sp.pedido) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Tienda de insumos</h1>
        <p className="text-sm text-slate-600">Bolsas, etiquetas, cinta, playo y más. Pagas aquí y te lo lleva el repartidor junto con tu recolección, sin costo de envío.</p>
      </div>
      {justOrdered && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ¡Listo! Pedido {storeFolio(justOrdered.number)} pagado. {justOrdered.pickup ? `Te lo llevamos el ${DIA.format(justOrdered.pickup.scheduledFor)} con tu recolección.` : "Lo agendamos con tu siguiente recolección."}
        </p>
      )}
      {typeof sp.pedido === "string" && !justOrdered && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Estamos confirmando tu pago con Mercado Pago; en un momento aparece abajo.</p>}
      {sp.pago === "error" && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">El pago no se completó. No se hizo ningún cargo.</p>}
      {!branches.length && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Agrega primero una dirección en Menú → Direcciones y accesos.</p>}
      {products.length ? (
        <StoreClient
          products={[...products].sort((a, b) => Number(b.category === "Insumos") - Number(a.category === "Insumos")).map((p) => ({ id: p.id, name: p.name, category: p.category, price: Number(p.price), imageUrl: p.imageUrl, description: p.description }))}
          branches={branches}
          favor={-Number(balance)}
          cardEnabled={mpConfigured()}
          deliveryText={deliveryText}
        />
      ) : (
        <Card><p className="text-sm text-slate-500">El catálogo se está cargando; vuelve en unos minutos.</p></Card>
      )}
      {orders.length > 0 && (
        <Card title="Mis pedidos de insumos">
          <ul className="divide-y divide-slate-100 text-sm">
            {orders.map((o) => {
              const [label, tone] = STORE_STATUS[o.status];
              return (
                <li key={o.id} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{storeFolio(o.number)}</span> · {mxn(o.total)}
                    <span className="block truncate text-xs text-slate-500">{(o.items as unknown as StoreItem[]).map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
                    {o.pickup && o.status !== "DELIVERED" && <span className="block text-xs text-slate-500">Entrega: {DIA.format(o.pickup.scheduledFor)}</span>}
                  </span>
                  <Badge tone={tone}>{label}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
