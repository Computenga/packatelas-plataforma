// Despacho y acciones del repartidor [A04, A05, R01, R03, R06, R07, R10, R11, R14].
import type { Prisma, PrismaClient, OrderStatus } from "../generated/prisma/client.ts";
import { addOrderEvent, audit } from "./orders.ts";
import { getMaxAttempts, markReturning, mustReturn } from "./failures.ts";
import { sendPush } from "./push.ts";

type Db = PrismaClient | Prisma.TransactionClient;

/** Estados desde los que un pedido se puede asignar o reasignar. */
export const ASSIGNABLE: OrderStatus[] = ["CREATED", "ASSIGNED", "RESCHEDULED", "FAILED"];
/** Pedidos activos en la ruta de un repartidor. */
export const IN_ROUTE: OrderStatus[] = ["ASSIGNED", "OUT_FOR_DELIVERY"];

export const FAIL_REASONS = {
  nadie: "No había nadie",
  direccion: "Dirección incorrecta o incompleta",
  rechazo: "El cliente rechazó el paquete",
  acceso: "Sin acceso al domicilio",
  reprogramo: "El cliente pidió otra fecha",
  zona: "Zona insegura o fuera de cobertura",
  otro: "Otro motivo",
} as const;
export type FailReason = keyof typeof FAIL_REASONS;

export async function assignOrders(prisma: PrismaClient, orderIds: string[], driverId: string, actorUserId?: string) {
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, include: { user: true } });
  if (!driver.active || !driver.user.active) throw new Error("El repartidor está inactivo");
  let assigned = 0;
  for (const orderId of orderIds) {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || !ASSIGNABLE.includes(order.status)) return;
      if (order.driverId === driverId && order.status === "ASSIGNED") return;
      await tx.order.update({ where: { id: orderId }, data: { driverId } });
      await addOrderEvent(tx, {
        orderId,
        type: "assigned",
        source: "ADMIN",
        toStatus: "ASSIGNED",
        actorUserId,
        note: `Asignado a ${driver.user.name}`,
      });
      assigned++;
    });
  }
  if (assigned) void sendPush(prisma, [driver.userId], { title: "Pedidos asignados", body: `Tienes ${assigned} pedido(s) nuevo(s) en tu ruta`, url: "/repartidor", tag: "asignados" });
  return assigned;
}

export async function unassignOrders(prisma: PrismaClient, orderIds: string[], actorUserId?: string) {
  let n = 0;
  for (const orderId of orderIds) {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== "ASSIGNED") return;
      await tx.order.update({ where: { id: orderId }, data: { driverId: null } });
      await addOrderEvent(tx, { orderId, type: "unassigned", source: "ADMIN", toStatus: "CREATED", actorUserId });
      n++;
    });
  }
  return n;
}

export async function setShift(db: Db, driverId: string, onDuty: boolean, actorUserId?: string) {
  const d = await db.driver.update({
    where: { id: driverId },
    data: { onDuty, shiftStartedAt: onDuty ? new Date() : null },
  });
  await audit(db, {
    actorUserId,
    action: onDuty ? "driver.shift_started" : "driver.shift_ended",
    entity: "Driver",
    entityId: driverId,
    summary: onDuty ? "Inició turno" : "Terminó turno",
  });
  return d;
}

export type DriverEventInput = {
  driverId: string;
  actorUserId: string;
  clientEventId: string; // generado en el teléfono; hace idempotente la cola sin conexión
  orderId: string;
  type: "loaded" | "delivered" | "failed";
  occurredAt: Date;
  lat?: number;
  lng?: number;
  receiverName?: string;
  reason?: FailReason;
  note?: string;
  photoKey?: string;
};

export type DriverEventResult =
  | { ok: true; duplicate: boolean; status: OrderStatus }
  | { ok: false; error: string };

/**
 * Aplica una acción del repartidor. Si el mismo clientEventId ya se registró (reintento de la
 * cola sin conexión), no hace nada y responde ok.
 */
export async function applyDriverEvent(prisma: PrismaClient, e: DriverEventInput): Promise<DriverEventResult> {
  const prior = await prisma.orderEvent.findUnique({ where: { clientEventId: e.clientEventId }, include: { order: true } });
  if (prior) return { ok: true, duplicate: true, status: prior.order.status };

  try {
    return await applyOnce(prisma, e);
  } catch (err) {
    // Dos reintentos simultáneos del mismo evento: gana uno, el otro es duplicado.
    if ((err as { code?: string }).code === "P2002") {
      const again = await prisma.orderEvent.findUnique({ where: { clientEventId: e.clientEventId }, include: { order: true } });
      if (again) return { ok: true, duplicate: true, status: again.order.status };
    }
    throw err;
  }
}

async function applyOnce(prisma: PrismaClient, e: DriverEventInput): Promise<DriverEventResult> {
  const now = new Date();
  // Una hora del teléfono en el futuro no es confiable.
  const occurredAt = e.occurredAt > now ? now : e.occurredAt;

  return prisma.$transaction(async (tx) => {
    // Bloquea el pedido primero: un reintento simultáneo espera aquí y después ve el evento ya guardado.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${e.orderId} FOR UPDATE`;
    const dup = await tx.orderEvent.findUnique({ where: { clientEventId: e.clientEventId }, include: { order: true } });
    if (dup) return { ok: true as const, duplicate: true, status: dup.order.status };
    const order = await tx.order.findUnique({ where: { id: e.orderId } });
    if (!order) return { ok: false as const, error: "Pedido no encontrado" };

    const base = {
      orderId: order.id,
      source: "DRIVER_APP" as const,
      actorUserId: e.actorUserId,
      lat: e.lat,
      lng: e.lng,
      occurredAt,
      clientEventId: e.clientEventId,
    };

    if (e.type === "loaded") {
      // Escaneo al cargar [R03]: si estaba libre, se lo asigna a sí mismo.
      const free = order.driverId == null && ASSIGNABLE.includes(order.status);
      if (!free && order.driverId !== e.driverId) return { ok: false as const, error: "Este pedido está asignado a otro repartidor" };
      if (!["CREATED", "ASSIGNED", "RESCHEDULED", "FAILED", "OUT_FOR_DELIVERY"].includes(order.status)) {
        return { ok: false as const, error: "Este pedido ya no está pendiente de entrega" };
      }
      if (free) await tx.order.update({ where: { id: order.id }, data: { driverId: e.driverId } });
      await addOrderEvent(tx, { ...base, type: "scanned_loaded", toStatus: "OUT_FOR_DELIVERY" });
      return { ok: true as const, duplicate: false, status: "OUT_FOR_DELIVERY" as OrderStatus };
    }

    if (order.driverId !== e.driverId) return { ok: false as const, error: "Este pedido no está en tu ruta" };
    if (!IN_ROUTE.includes(order.status)) return { ok: false as const, error: "Este pedido ya no está pendiente de entrega" };

    if (e.type === "delivered") {
      if (!e.photoKey) return { ok: false as const, error: "Falta la foto de entrega" };
      const ev = await addOrderEvent(tx, {
        ...base,
        type: "delivered",
        toStatus: "DELIVERED",
        note: e.receiverName ? `Recibió: ${e.receiverName}` : e.note,
      });
      await tx.evidence.create({
        data: { orderId: order.id, eventId: ev.id, kind: "PHOTO", storageKey: e.photoKey, receiverName: e.receiverName },
      });
      await tx.order.update({ where: { id: order.id }, data: { attempts: { increment: 1 } } });
      return { ok: true as const, duplicate: false, status: "DELIVERED" as OrderStatus };
    }

    // failed
    const reason = e.reason && e.reason in FAIL_REASONS ? e.reason : "otro";
    const ev = await addOrderEvent(tx, {
      ...base,
      type: "failed",
      toStatus: "FAILED",
      note: [FAIL_REASONS[reason], e.note].filter(Boolean).join(" · "),
      data: { reason },
    });
    if (e.photoKey) {
      await tx.evidence.create({ data: { orderId: order.id, eventId: ev.id, kind: "PHOTO", storageKey: e.photoKey } });
    }
    const updated = await tx.order.update({ where: { id: order.id }, data: { attempts: { increment: 1 } } });
    if (mustReturn(reason, updated.attempts, await getMaxAttempts(tx))) {
      const why = reason === "rechazo" ? "el cliente lo rechazó" : `${updated.attempts} intento(s) sin entregar`;
      await markReturning(tx, order.id, `Llevar a bodega: ${why}`, "SYSTEM");
      return { ok: true as const, duplicate: false, status: "RETURNING" as OrderStatus };
    }
    return { ok: true as const, duplicate: false, status: "FAILED" as OrderStatus };
  });
}

/** Guarda puntos de ubicación del repartidor y actualiza su última posición [R10]. */
export async function recordLocations(
  db: Db,
  driverId: string,
  points: { lat: number; lng: number; accuracy?: number; speed?: number; battery?: number; at: Date }[],
) {
  const valid = points.filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180).slice(-200);
  if (valid.length === 0) return 0;
  await db.locationPing.createMany({
    data: valid.map((p) => ({ driverId, lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, battery: p.battery, recordedAt: p.at })),
  });
  const last = valid.reduce((a, b) => (b.at > a.at ? b : a));
  await db.driver.update({ where: { id: driverId }, data: { lastLat: last.lat, lastLng: last.lng, lastLocationAt: last.at } });
  return valid.length;
}
