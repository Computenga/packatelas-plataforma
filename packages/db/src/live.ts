// "En vivo": los envíos que estuvieron en la calle en un día (hora CDMX). Son los ojos del día:
// cuántos siguen en tránsito, cuántos ya se entregaron y cuántos fallaron.
//  - ML: estuvieron en shipped / out_for_delivery en algún momento del día, o se asignaron a un
//    repartidor ese día, o se escanearon para reparto ese día.
//  - Externos: fecha compromiso ese día, o escaneados para reparto ese día, o asignados ese día.
import type { OrderStatus, PrismaClient } from "../generated/prisma/client.ts";

/** Eventos que cuentan como "asignado" o "salió a reparto". */
const DAY_EVENTS = ["assigned", "scanned_loaded", "flex_assigned", "flex_transfer"];

export async function liveOrderIds(prisma: PrismaClient, from: Date, to: Date): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM "Order" o
    WHERE o.kind = 'DELIVERY' AND o.source <> 'IMPORT' AND o."createdAt" < ${to} AND (
      EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."orderId" = o.id AND e.type = ANY(${DAY_EVENTS}) AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to})
      OR (o."mlShipmentId" IS NOT NULL AND (
        -- Cambió de estado en ML durante el día estando en camino (salió, se entregó o falló).
        EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."orderId" = o.id AND e.type = 'ml_status' AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to}
                AND (e.data->>'status' IN ('shipped', 'delivered', 'not_delivered') OR e.data->>'previous' = 'shipped'))
        -- Sigue en camino en ML desde antes de que terminara el día.
        OR (o."mlStatus" = 'shipped' AND NOT EXISTS (
              SELECT 1 FROM "OrderEvent" e WHERE e."orderId" = o.id AND e.type = 'ml_status' AND e.data->>'status' = 'shipped' AND e."occurredAt" >= ${to}))
      ))
      OR (o."mlShipmentId" IS NULL AND o."requestedDeliveryAt" >= ${from} AND o."requestedDeliveryAt" < ${to})
    )`;
  return rows.map((r) => r.id);
}

export type LiveBucket = "transito" | "entregado" | "fallido" | "cancelado";

/** En qué columna del día cae un envío (si ML ya lo da por entregado, cuenta como entregado). */
export function liveBucket(o: { status: OrderStatus; mlStatus: string | null }): LiveBucket {
  if (o.status === "DELIVERED" || o.mlStatus === "delivered") return "entregado";
  if (o.status === "CANCELLED" || o.mlStatus === "cancelled") return "cancelado";
  if (["FAILED", "RESCHEDULED", "RETURNING", "RETURNED_TO_WAREHOUSE", "RETURNED_TO_SELLER"].includes(o.status) || o.mlStatus === "not_delivered") return "fallido";
  return "transito";
}
