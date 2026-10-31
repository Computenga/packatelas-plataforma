import type { Metadata } from "next";
import { orderStops, prisma, WAREHOUSE_ADDRESS } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui";
import { PickupActions } from "./pickup-card";

export const metadata: Metadata = { title: "Recolecciones" };
// scheduledFor es solo fecha (medianoche UTC): se formatea en UTC para no correrla un día.
const DIA = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", dateStyle: "medium" });

export default async function RepartidorRecolecciones() {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) return null;
  const pickups = await prisma.pickup.findMany({
    where: { driverId: driver.id, status: "ASSIGNED" },
    include: { client: { select: { name: true } }, branch: true, order: { select: { code: true, status: true } } },
    orderBy: { scheduledFor: "asc" },
  });
  // Orden sugerido desde donde está el repartidor; la que va en camino, primero.
  const start = driver.lastLat != null && driver.lastLng != null ? { lat: driver.lastLat, lng: driver.lastLng } : null;
  const { ordered } = await orderStops(start, pickups.map((p) => ({ ...p, lat: p.branch.lat, lng: p.branch.lng })));
  const list = [...ordered].sort((a, b) => Number(b.order?.status === "OUT_FOR_DELIVERY") - Number(a.order?.status === "OUT_FOR_DELIVERY"));

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Recolecciones ({list.length})</h1>
      <p className="text-xs text-slate-500">Todo lo que recolectes va a {WAREHOUSE_ADDRESS}.</p>
      {list.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No tienes recolecciones asignadas.</p>
      )}
      {list.map((p, i) => {
        const dest = p.branch.lat != null ? `${p.branch.lat},${p.branch.lng}` : encodeURIComponent(p.branch.address);
        const enRoute = p.order?.status === "OUT_FOR_DELIVERY";
        return (
          <div key={p.id} className={`rounded-xl border bg-white p-4 ${enRoute ? "border-brand ring-1 ring-brand" : "border-slate-200"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">
                  {i + 1}. {p.order?.code ?? "Recolección"}
                </p>
                <p className="font-semibold">{p.client.name}</p>
                <p className="text-sm text-slate-600">{p.branch.name} · {p.branch.address}</p>
                <p className="text-xs text-slate-500">
                  {DIA.format(p.scheduledFor)}
                  {p.expectedCount && ` · ~${p.expectedCount} paquetes`}
                  {p.note && ` · ${p.note}`}
                </p>
              </div>
              {enRoute ? <Badge tone="blue">En camino</Badge> : <Badge>Pendiente</Badge>}
            </div>
            <PickupActions pickupId={p.id} mapsUrl={`https://www.google.com/maps/dir/?api=1&destination=${dest}`} phone={p.branch.phone} enRoute={enRoute} />
          </div>
        );
      })}
    </div>
  );
}
