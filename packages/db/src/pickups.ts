// Recolecciones [A06, R09, C05, F07].
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { addOrderEvent, audit } from "./orders.ts";
import { isPickupBlocked } from "./ledger.ts";
import { enqueueNotification, notifyPickupBlocked } from "./notifications.ts";
import { orderStops } from "./routing.ts";

type Db = PrismaClient | Prisma.TransactionClient;

/** Destino de toda recolección. */
export const WAREHOUSE_ADDRESS = "Bodega Packatelas · Juan Lucas de Lassaga 54, Obrera, Cuauhtémoc, CDMX";

const DAY_MX = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const firstName = (s?: string | null) => (s ?? "").trim().split(/\s+/)[0] || "";

/**
 * Cada recolección es también un pedido (RC-000123): origen la sucursal del cliente, destino la
 * bodega. Así tiene historial, evidencia fotográfica, repartidor y enlace de seguimiento.
 */
export async function ensurePickupOrder(db: Db, pickupId: string) {
  const p = await db.pickup.findUniqueOrThrow({ where: { id: pickupId }, include: { order: true, branch: true, client: true } });
  if (p.order) return p.order;
  const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_code_seq') AS n`;
  try {
    const order = await db.order.create({
      data: {
        code: `RC-${n.toString().padStart(6, "0")}`,
        kind: "PICKUP",
        source: "MANUAL",
        clientId: p.clientId,
        branchId: p.branchId,
        pickupId: p.id,
        addressLine: p.branch.address,
        lat: p.branch.lat,
        lng: p.branch.lng,
        recipientName: p.client.contactName ?? p.client.name,
        recipientPhone: p.branch.phone ?? p.client.phone,
        itemsSummary: p.expectedCount ? `~${p.expectedCount} paquete(s) por recolectar` : null,
        instructions: p.note,
        requestedDeliveryAt: p.scheduledFor,
        driverId: p.driverId,
      },
    });
    await addOrderEvent(db, {
      orderId: order.id,
      type: "created",
      source: "SYSTEM",
      toStatus: "CREATED",
      note: `Recolección del ${DAY_MX.format(p.scheduledFor)} en ${p.branch.name} → ${WAREHOUSE_ADDRESS}`,
    });
    return order;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return db.order.findUniqueOrThrow({ where: { pickupId } });
    throw e;
  }
}

/** Fecha YYYY-MM-DD → Date a medianoche UTC, como se guarda en columnas @db.Date. */
export const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** Día de la semana 1=lunes … 7=domingo. */
export const isoWeekday = (ymd: string) => ((dateOnly(ymd).getUTCDay() + 6) % 7) + 1;

/** Hoy en la Ciudad de México como YYYY-MM-DD. */
export const todayMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

/**
 * Crea las recolecciones automáticas del día para las sucursales que la tienen programada.
 * Idempotente y seguro en paralelo (candado por fecha). Si el cliente tiene adeudo sin
 * exención, la recolección nace bloqueada.
 */
export async function generateAutoPickups(prisma: PrismaClient, ymd: string): Promise<number> {
  const weekday = isoWeekday(ymd);
  const date = dateOnly(ymd);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"auto-pickups:" + ymd}))`;
    const branches = await tx.branch.findMany({
      where: { active: true, autoPickup: true, autoPickupDays: { has: weekday }, client: { active: true } },
      select: { id: true, clientId: true },
    });
    let created = 0;
    for (const b of branches) {
      const exists = await tx.pickup.findFirst({ where: { branchId: b.id, scheduledFor: date, automatic: true } });
      if (exists) continue;
      const blocked = await isPickupBlocked(tx, b.clientId);
      const p = await tx.pickup.create({
        data: { clientId: b.clientId, branchId: b.id, scheduledFor: date, automatic: true, status: blocked ? "BLOCKED" : "SCHEDULED" },
      });
      if (!blocked) await ensurePickupOrder(tx, p.id);
      if (blocked) await notifyPickupBlocked(tx, b.clientId);
      created++;
    }
    return created;
  });
}

/**
 * Recalcula el bloqueo de las recolecciones pendientes del cliente (de hoy en adelante)
 * después de un abono, ajuste o exención.
 */
export async function refreshBlockedPickups(prisma: PrismaClient, clientId: string) {
  const blocked = await isPickupBlocked(prisma, clientId);
  const r = await prisma.pickup.updateMany({
    where: { clientId, scheduledFor: { gte: dateOnly(todayMx()) }, status: blocked ? "SCHEDULED" : "BLOCKED" },
    data: { status: blocked ? "BLOCKED" : "SCHEDULED" },
  });
  // Recién pausada: avisar a la tienda (una vez al día) [C11].
  if (blocked && r.count) await notifyPickupBlocked(prisma, clientId);
}

/**
 * Recalcula el bloqueo de todas las recolecciones pendientes. Lo corre el proceso en segundo
 * plano cada hora: así el lunes amanecen bloqueados los de crédito que no liquidaron [F08].
 */
export async function refreshAllBlockedPickups(prisma: PrismaClient): Promise<number> {
  const pending = await prisma.pickup.findMany({
    where: { scheduledFor: { gte: dateOnly(todayMx()) }, status: { in: ["SCHEDULED", "BLOCKED"] } },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  for (const p of pending) await refreshBlockedPickups(prisma, p.clientId);
  return pending.length;
}

/** Solicitud de recolección (portal cliente o administración). Nace bloqueada si hay adeudo. */
export async function requestPickup(
  prisma: PrismaClient,
  input: { clientId: string; branchId: string; ymd: string; expectedCount?: number; note?: string },
  actorUserId?: string,
) {
  const branch = await prisma.branch.findFirst({ where: { id: input.branchId, clientId: input.clientId, active: true } });
  if (!branch) throw new Error("Sucursal no válida");
  const blocked = await isPickupBlocked(prisma, input.clientId);
  const p = await prisma.pickup.create({
    data: {
      clientId: input.clientId,
      branchId: branch.id,
      scheduledFor: dateOnly(input.ymd),
      status: blocked ? "BLOCKED" : "SCHEDULED",
      expectedCount: input.expectedCount,
      note: input.note,
    },
  });
  if (!blocked) await ensurePickupOrder(prisma, p.id);
  await audit(prisma, {
    actorUserId,
    action: "pickup.requested",
    entity: "Pickup",
    entityId: p.id,
    summary: `Recolección ${input.ymd} en ${branch.name}${blocked ? " (bloqueada por adeudo)" : ""}`,
  });
  return p;
}

export async function assignPickup(prisma: PrismaClient, pickupId: string, driverId: string | null, actorUserId?: string) {
  const p = await prisma.pickup.findUniqueOrThrow({ where: { id: pickupId }, include: { branch: true, client: true } });
  if (p.status === "BLOCKED") throw new Error("Recolección bloqueada por adeudo");
  if (["COLLECTED", "CANCELLED", "FAILED"].includes(p.status)) throw new Error("Esta recolección ya se cerró");
  if (p.driverId === driverId) return;
  const driver = driverId ? await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, include: { user: { select: { name: true } } } }) : null;
  const order = await ensurePickupOrder(prisma, pickupId);
  await prisma.$transaction(async (tx) => {
    await tx.pickup.update({ where: { id: pickupId }, data: { driverId, status: driverId ? "ASSIGNED" : "SCHEDULED" } });
    await tx.order.update({ where: { id: order.id }, data: { driverId } });
    await addOrderEvent(tx, {
      orderId: order.id,
      type: driverId ? "assigned" : "unassigned",
      source: "ADMIN",
      toStatus: driverId ? "ASSIGNED" : "CREATED",
      actorUserId,
      note: driver ? `Recolección asignada a ${driver.user.name}` : "Recolección sin repartidor",
    });
  });
  await audit(prisma, { actorUserId, action: "pickup.assigned", entity: "Pickup", entityId: pickupId, summary: driver ? `Recolección asignada a ${driver.user.name}` : "Recolección desasignada" });
  if (driver) {
    await enqueueNotification(prisma, {
      event: "recoleccion_asignada",
      to: order.recipientPhone,
      orderId: order.id,
      clientId: p.clientId,
      params: [firstName(p.client.contactName) || p.client.name, DAY_MX.format(p.scheduledFor), p.branch.name, firstName(driver.user.name)],
      dedupeKey: `recoleccion_asignada:${order.id}:${driver.id}`,
    }).catch(() => false);
  }
}

/**
 * El repartidor va en camino a esta recolección: el pedido pasa a "en camino" y la tienda recibe por
 * WhatsApp el enlace para seguirlo en tiempo real (una vez por recolección).
 */
export async function startPickupRoute(prisma: PrismaClient, pickupId: string, driverId: string, opts: { trackingUrl: (orderId: string) => string; actorUserId?: string; auto?: boolean }) {
  const p = await prisma.pickup.findUniqueOrThrow({ where: { id: pickupId }, include: { branch: true, client: true, driver: { include: { user: { select: { name: true } } } } } });
  if (p.driverId !== driverId || p.status !== "ASSIGNED") return false;
  const order = await ensurePickupOrder(prisma, pickupId);
  if (order.status === "OUT_FOR_DELIVERY") return false;
  await addOrderEvent(prisma, {
    orderId: order.id,
    type: "pickup_en_route",
    source: opts.auto ? "SYSTEM" : "DRIVER_APP",
    toStatus: "OUT_FOR_DELIVERY",
    actorUserId: opts.actorUserId,
    note: opts.auto ? "Es la siguiente de su lista: va en camino" : "El repartidor va en camino",
  });
  await enqueueNotification(prisma, {
    event: "recoleccion_en_camino",
    to: order.recipientPhone,
    orderId: order.id,
    clientId: p.clientId,
    params: [firstName(p.client.contactName) || p.client.name, firstName(p.driver?.user.name) || "Tu repartidor", p.branch.name, opts.trackingUrl(order.id)],
    dedupeKey: `recoleccion_en_camino:${order.id}`,
  }).catch(() => false);
  return true;
}

/** Tras cerrar una recolección, la más cercana de las que le quedan pasa a "en camino". */
export async function startNextPickup(prisma: PrismaClient, driverId: string, opts: { trackingUrl: (orderId: string) => string }) {
  const today = dateOnly(todayMx());
  const pending = await prisma.pickup.findMany({
    where: { driverId, status: "ASSIGNED", scheduledFor: { lte: today } },
    include: { branch: { select: { lat: true, lng: true } }, order: { select: { status: true } } },
  });
  if (!pending.length || pending.some((p) => p.order?.status === "OUT_FOR_DELIVERY")) return null;
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { lastLat: true, lastLng: true } });
  const start = d?.lastLat != null && d.lastLng != null ? { lat: d.lastLat, lng: d.lastLng } : null;
  const { ordered } = await orderStops(start, pending.map((p) => ({ id: p.id, lat: p.branch.lat, lng: p.branch.lng })));
  const next = ordered[0];
  if (!next) return null;
  await startPickupRoute(prisma, next.id, driverId, { trackingUrl: opts.trackingUrl, auto: true });
  return next.id;
}

/** El repartidor confirma (con número de paquetes) o reporta que no pudo recolectar [R09]. */
export async function completePickup(
  prisma: PrismaClient,
  input: { pickupId: string; driverId: string; collected: boolean; count?: number; note?: string; photoKeys?: string[]; lat?: number; lng?: number },
  actorUserId?: string,
) {
  const p = await prisma.pickup.findUniqueOrThrow({ where: { id: input.pickupId } });
  if (p.driverId !== input.driverId) throw new Error("Esta recolección no está asignada a ti");
  if (p.status !== "ASSIGNED") throw new Error("Esta recolección no está activa");
  if (input.collected && (!Number.isInteger(input.count) || input.count! < 1 || input.count! > 5000)) {
    throw new Error("Indica cuántos paquetes recibiste");
  }
  const photos = (input.photoKeys ?? []).filter((k) => /^evidence\/[\w/.-]+$/.test(k)).slice(0, 6);
  if (input.collected && photos.length === 0) throw new Error("Toma al menos una foto de lo que recolectaste");
  const order = await ensurePickupOrder(prisma, p.id);
  const done = await prisma.pickup.update({
    where: { id: p.id },
    data: {
      status: input.collected ? "COLLECTED" : "FAILED",
      collectedCount: input.collected ? input.count : 0,
      collectedAt: new Date(),
      note: input.note ?? p.note,
    },
  });
  await prisma.$transaction(async (tx) => {
    const ev = await addOrderEvent(tx, {
      orderId: order.id,
      type: input.collected ? "picked_up" : "pickup_failed",
      source: "DRIVER_APP",
      toStatus: input.collected ? "DELIVERED" : "FAILED",
      actorUserId,
      lat: input.lat,
      lng: input.lng,
      note: input.collected ? `Recolectados ${input.count} paquete(s)${input.note ? ` · ${input.note}` : ""}` : `No se pudo recolectar${input.note ? `: ${input.note}` : ""}`,
      data: input.collected ? { count: input.count! } : undefined,
    });
    if (photos.length) await tx.evidence.createMany({ data: photos.map((storageKey) => ({ orderId: order.id, eventId: ev.id, kind: "PHOTO" as const, storageKey })) });
  });
  await audit(prisma, {
    actorUserId,
    action: input.collected ? "pickup.collected" : "pickup.failed",
    entity: "Pickup",
    entityId: p.id,
    summary: input.collected ? `Recolectados ${input.count} paquete(s)` : `No se pudo recolectar${input.note ? `: ${input.note}` : ""}`,
  });
  return done;
}
