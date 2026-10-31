// Inventario por repartidor: qué paquetes debe traer físicamente cada uno.
// Entra al asignárselo (despacho, al tomarlo él o por Flex). Sale solo si:
//  - queda entregado en ML (si es de ML) y con foto de evidencia en la app, o
//  - un admin o despachador lo recibe de vuelta en Devoluciones, o
//  - pasa a otro repartidor (traspaso) o el despacho se lo quita antes de que lo cargue.
// Cada movimiento queda en el historial del pedido.
import type { CustodyEnd, Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { addOrderEvent } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;

const END_TEXT: Record<CustodyEnd, string> = {
  DELIVERED: "entregado (confirmado en ML y con evidencia)",
  RETURNED: "recibido de vuelta en Devoluciones",
  TRANSFERRED: "traspasado a otro repartidor",
  UNASSIGNED: "el despacho se lo quitó antes de cargarlo",
};

const driverName = async (db: Db, driverId: string) =>
  (await db.driver.findUnique({ where: { id: driverId }, select: { user: { select: { name: true } } } }))?.user.name ?? "repartidor";

/** El paquete entra al inventario del repartidor (si ya lo tenía otro, es un traspaso). */
export async function custodyStart(db: Db, orderId: string, driverId: string, opts: { actorUserId?: string; how: string; source?: "ADMIN" | "DRIVER_APP" | "FLEX_HANDSHAKE" | "SYSTEM" }) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { kind: true, source: true } });
  if (!order || order.kind !== "DELIVERY" || order.source === "IMPORT") return false;
  const open = await db.driverCustody.findFirst({ where: { orderId, endedAt: null } });
  if (open?.driverId === driverId) return false;
  const name = await driverName(db, driverId);
  const source = opts.source ?? "ADMIN";
  if (open) {
    const prev = await driverName(db, open.driverId);
    await db.driverCustody.update({ where: { id: open.id }, data: { endedAt: new Date(), endReason: "TRANSFERRED", endedById: opts.actorUserId } });
    await addOrderEvent(db, { orderId, type: "custody_transfer", source, actorUserId: opts.actorUserId, note: `Inventario: pasa de ${prev} a ${name}`, data: { from: open.driverId, to: driverId } });
  } else {
    await addOrderEvent(db, { orderId, type: "custody_in", source, actorUserId: opts.actorUserId, note: `Inventario: entra al de ${name} (${opts.how})`, data: { driverId } });
  }
  await db.driverCustody.create({ data: { orderId, driverId, how: opts.how, startedById: opts.actorUserId } });
  return true;
}

/** Cierra el inventario abierto del pedido con el motivo dado. */
export async function custodyEnd(db: Db, orderId: string, reason: CustodyEnd, opts: { actorUserId?: string; source?: "ADMIN" | "SCAN" | "ML_SYNC" | "SYSTEM" | "DRIVER_APP" } = {}) {
  const open = await db.driverCustody.findFirst({ where: { orderId, endedAt: null } });
  if (!open) return false;
  const r = await db.driverCustody.updateMany({ where: { id: open.id, endedAt: null }, data: { endedAt: new Date(), endReason: reason, endedById: opts.actorUserId } });
  if (!r.count) return false;
  const name = await driverName(db, open.driverId);
  await addOrderEvent(db, { orderId, type: "custody_out", source: opts.source ?? "SYSTEM", actorUserId: opts.actorUserId, note: `Inventario: sale del de ${name} · ${END_TEXT[reason]}`, data: { driverId: open.driverId, reason } });
  return true;
}

/** ¿Ya cumple para salir por entregado? ML entregado (si es de ML) + foto de evidencia. */
export async function deliveryConfirmed(db: Db, orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { status: true, mlShipmentId: true, mlStatus: true, _count: { select: { evidence: { where: { kind: "PHOTO" } } } } } });
  if (!o || o.status !== "DELIVERED" || o._count.evidence === 0) return false;
  return o.mlShipmentId == null || o.mlStatus === "delivered";
}

/** Revisa un pedido y, si ya cumple, lo saca del inventario. */
export async function reconcileCustody(db: Db, orderId: string) {
  if (!(await deliveryConfirmed(db, orderId))) return false;
  return custodyEnd(db, orderId, "DELIVERED", { source: "SYSTEM" });
}

/** Proceso en segundo plano: revisa los entregados que siguen en algún inventario. */
export async function sweepCustody(prisma: PrismaClient, limit = 500) {
  const open = await prisma.driverCustody.findMany({ where: { endedAt: null, order: { status: "DELIVERED" } }, select: { orderId: true }, take: limit });
  let n = 0;
  for (const c of open) if (await reconcileCustody(prisma, c.orderId)) n++;
  return n;
}

/** Por qué un paquete sigue en el inventario (para la pantalla). */
export function custodyFlag(o: { status: string; mlShipmentId: bigint | null; mlStatus: string | null; photos: number }) {
  if (o.status === "DELIVERED") {
    if (!o.photos) return o.mlShipmentId != null && o.mlStatus !== "delivered" ? "Entregado en la app sin foto y sin confirmar en ML" : "Entregado sin foto de evidencia";
    return "Entregado en la app; falta que ML lo marque entregado";
  }
  if (o.mlStatus === "delivered") return "ML lo marca entregado; falta la foto de evidencia en la app";
  if (o.status === "CANCELLED") return "Cancelado: debe regresarlo a bodega";
  if (o.status === "RETURNING" || o.status === "FAILED") return "No entregado: debe regresarlo a bodega";
  return null;
}
