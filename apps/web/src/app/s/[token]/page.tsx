import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, WAREHOUSE_ADDRESS, type OrderStatus } from "@packatelas/db";
import { orderIdFromToken } from "@/lib/tracking";
import { fecha, hace } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { TrackMap } from "./track-map";
import { Isotipo } from "@/components/brand";

export const metadata: Metadata = { title: "Seguimiento de tu envío", robots: { index: false, follow: false } };

const STEPS = [
  { key: "registrado", label: "Registrado" },
  { key: "camino", label: "En camino" },
  { key: "entregado", label: "Entregado" },
] as const;

function stage(s: OrderStatus): { step: number; title: string; tone: "ok" | "warn" | "info" } {
  switch (s) {
    case "DELIVERED": return { step: 2, title: "¡Entregado!", tone: "ok" };
    case "OUT_FOR_DELIVERY": return { step: 1, title: "Tu paquete va en camino", tone: "info" };
    case "FAILED":
    case "RESCHEDULED": return { step: 1, title: "No pudimos entregarlo; lo intentaremos de nuevo", tone: "warn" };
    case "RETURNING":
    case "RETURNED_TO_WAREHOUSE":
    case "RETURNED_TO_SELLER": return { step: 1, title: "Tu paquete regresa con la tienda", tone: "warn" };
    case "CANCELLED": return { step: 0, title: "Envío cancelado", tone: "warn" };
    default: return { step: 0, title: "Recibimos tu paquete y pronto saldrá a entrega", tone: "info" };
  }
}

// Recolección: el repartidor va a la tienda del cliente y lleva los paquetes a bodega.
const PICKUP_STEPS = [
  { key: "programada", label: "Programada" },
  { key: "camino", label: "En camino" },
  { key: "recolectada", label: "Recolectada" },
] as const;

function pickupStage(s: OrderStatus, driver?: string): { step: number; title: string; tone: "ok" | "warn" | "info" } {
  switch (s) {
    case "DELIVERED": return { step: 2, title: "¡Recolectamos tus paquetes!", tone: "ok" };
    case "OUT_FOR_DELIVERY": return { step: 1, title: `${driver ?? "Tu repartidor"} va en camino a recoger tus paquetes`, tone: "info" };
    case "ASSIGNED": return { step: 0, title: `Tu recolección está asignada a ${driver ?? "un repartidor"}`, tone: "info" };
    case "FAILED": return { step: 1, title: "No pudimos hacer la recolección", tone: "warn" };
    case "CANCELLED": return { step: 0, title: "Recolección cancelada", tone: "warn" };
    default: return { step: 0, title: "Tu recolección está programada", tone: "info" };
  }
}

const LIVE_MS = 15 * 60_000;
const nowMs = () => Date.now();

/** Página pública para el comprador final [C12]: sin datos personales completos ni fotos. */
export default async function SeguimientoPage({ params }: PageProps<"/s/[token]">) {
  const id = orderIdFromToken((await params).token);
  if (!id) notFound();
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      code: true, kind: true, status: true, mlStatus: true, recipientName: true, neighborhood: true, city: true, lat: true, lng: true, deliveredAt: true, updatedAt: true,
      client: { select: { name: true } },
      driver: { select: { lastLat: true, lastLng: true, lastLocationAt: true, user: { select: { name: true } } } },
      events: {
        where: { type: { in: ["created", "scanned_loaded", "delivered", "failed", "rescheduled", "return_required", "ml_status", "assigned", "pickup_en_route", "picked_up", "pickup_failed"] } },
        orderBy: { occurredAt: "desc" },
        take: 12,
        select: { type: true, occurredAt: true, data: true },
      },
    },
  });
  if (!order) notFound();
  const pickup = order.kind === "PICKUP";
  // Si MercadoLibre ya lo marca entregado (p. ej. se entregó con la app Flex), así se muestra.
  const mlDelivered = !pickup && order.mlStatus === "delivered" && order.status !== "DELIVERED";
  const mlEvent = order.events.find((e) => e.type === "ml_status" && (e.data as { status?: string } | null)?.status === "delivered");
  const status: OrderStatus = mlDelivered ? "DELIVERED" : order.status;
  const deliveredAt = mlDelivered ? (mlEvent?.occurredAt ?? null) : order.deliveredAt;
  const driverFirst = order.driver?.user.name.split(" ")[0];
  const st = pickup ? pickupStage(status, driverFirst) : stage(status);
  const steps = pickup ? PICKUP_STEPS : STEPS;
  const events = order.events.filter((e) => e.type !== "ml_status" || (e.data as { status?: string } | null)?.status === "delivered").slice(0, 6);
  const now = nowMs();
  const live =
    status === "OUT_FOR_DELIVERY" && order.driver?.lastLat != null && order.driver.lastLocationAt && now - order.driver.lastLocationAt.getTime() < LIVE_MS
      ? { lat: order.driver.lastLat, lng: order.driver.lastLng! }
      : null;
  const dest = order.lat != null && order.lng != null ? { lat: order.lat, lng: order.lng } : null;
  const firstName = order.recipientName?.split(" ")[0];
  const EVENT: Record<string, string> = {
    created: pickup ? "Recolección programada" : "Registrado en Packatelas", scanned_loaded: "Salió a entrega", delivered: "Entregado", failed: "Intento de entrega",
    rescheduled: "Entrega reprogramada", return_required: "Regresa a la tienda", ml_status: "Entregado (Mercado Libre)",
    ...(pickup
      ? { assigned: "Repartidor asignado", pickup_en_route: "Va en camino", picked_up: "Paquetes recolectados", pickup_failed: "No se pudo recolectar" }
      : { assigned: "Asignado a repartidor" }),
  };

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6">
      {status === "OUT_FOR_DELIVERY" && <AutoRefresh seconds={pickup ? 30 : 60} />}
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-2">
          <Isotipo className="h-9 w-auto" />
          <div>
            <p className="font-bold leading-tight">Packatelas</p>
            <p className="text-xs text-slate-500">{pickup ? `Recolección para ${order.client.name}` : `Envío de ${order.client.name}`}</p>
          </div>
        </header>

        <section className={`rounded-2xl p-5 ${st.tone === "ok" ? "bg-emerald-600 text-white" : st.tone === "warn" ? "bg-amber-100 text-amber-900" : "bg-white"}`}>
          {firstName && <p className="text-sm opacity-80">Hola {firstName},</p>}
          <h1 className="mt-1 text-xl font-bold">{st.title}</h1>
          {status === "DELIVERED" && deliveredAt && <p className="mt-1 text-sm opacity-90">{fecha(deliveredAt)}</p>}
          {status !== "DELIVERED" && <p className="mt-1 text-sm opacity-70">Actualizado hace {hace(order.updatedAt, now)}</p>}
          <ol className="mt-4 flex items-center gap-2" aria-label="Avance">
            {steps.map((s, i) => (
              <li key={s.key} className="flex flex-1 flex-col items-center gap-1 text-center">
                <span className={`h-2 w-full rounded-full ${i <= st.step ? (st.tone === "ok" ? "bg-white" : "bg-brand") : "bg-black/10"}`} />
                <span className={`text-[11px] ${i <= st.step ? "font-semibold" : "opacity-60"}`}>{s.label}</span>
              </li>
            ))}
          </ol>
        </section>

        {(live || (dest && status === "OUT_FOR_DELIVERY")) && (
          <section className="space-y-2">
            <TrackMap dest={dest} driver={live} />
            <p className="text-xs text-slate-500">
              {live
                ? `${driverFirst} va en camino · ubicación de hace ${hace(order.driver!.lastLocationAt!, now)}`
                : pickup
                  ? "La ubicación del repartidor aparecerá en cuanto su teléfono la envíe."
                  : "La ubicación del repartidor aparecerá cuando esté cerca."}
            </p>
          </section>
        )}

        <section className="rounded-2xl bg-white p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">{pickup ? "Recolección" : "Envío"}</p>
          <p className="font-mono font-semibold">{order.code}</p>
          {pickup ? (
            <p className="mt-2 text-slate-600">Destino de los paquetes: {WAREHOUSE_ADDRESS}</p>
          ) : (
            (order.neighborhood || order.city) && <p className="mt-2 text-slate-600">Destino: {[order.neighborhood, order.city].filter(Boolean).join(", ")}</p>
          )}
          <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            {events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{EVENT[e.type]}</span>
                <span className="text-xs text-slate-500">{fecha(e.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-center text-xs text-slate-400">{pickup ? "¿Dudas? Escríbenos por WhatsApp." : "¿Dudas sobre tu compra? Contacta a la tienda."}</p>
      </div>
    </main>
  );
}
