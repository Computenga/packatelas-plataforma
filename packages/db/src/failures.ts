// Fallidos, reprogramados y regreso a bodega [A11, R07, R13].
//
// Flujo: el repartidor marca "no entregado" → FAILED. Si el cliente lo rechazó o ya se agotaron
// los intentos, pasa solo a RETURNING ("llevar a bodega"). Desde despacho se decide:
// reprogramar (vuelve a la cola) o regresar a bodega. Ya en bodega, se puede reintentar la entrega
// o devolver al vendedor (returns.ts).
import type { Prisma, PrismaClient, OrderStatus } from "../generated/prisma/client.ts";
import { addOrderEvent, audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export const MAX_ATTEMPTS_KEY = "orders.maxAttempts";
export const DEFAULT_MAX_ATTEMPTS = 2;

/** Intentos de entrega antes de mandarlo a bodega (configurable en Setting). */
export async function getMaxAttempts(db: Db): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: MAX_ATTEMPTS_KEY } });
  const n = Number(s?.value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_MAX_ATTEMPTS;
}

export async function setMaxAttempts(prisma: PrismaClient, n: number, actorUserId?: string) {
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("Debe ser de 1 a 10 intentos");
  await prisma.setting.upsert({ where: { key: MAX_ATTEMPTS_KEY }, update: { value: n }, create: { key: MAX_ATTEMPTS_KEY, value: n } });
  await audit(prisma, { actorUserId, action: "settings.max_attempts", entity: "Setting", entityId: MAX_ATTEMPTS_KEY, summary: `Intentos antes de regresar a bodega: ${n}` });
}

/** ¿Este fallo manda el paquete a bodega? */
export function mustReturn(reason: string, attemptsAfter: number, maxAttempts: number) {
  return reason === "rechazo" || attemptsAfter >= maxAttempts;
}

/** Marca el paquete como "llevar a bodega" y abre su custodia (pendiente de recibir). */
export async function markReturning(tx: Prisma.TransactionClient, orderId: string, note: string, source: "ADMIN" | "SYSTEM", actorUserId?: string | null) {
  await addOrderEvent(tx, { orderId, type: "return_required", source, toStatus: "RETURNING", actorUserId, note });
  await tx.returnCustody.upsert({
    where: { orderId },
    update: { status: "PENDING_RECEIPT", receivedAt: null, receivedById: null },
    create: { orderId, status: "PENDING_RECEIPT" },
  });
}

const SEND_BACK_FROM: OrderStatus[] = ["FAILED", "RESCHEDULED", "ASSIGNED", "OUT_FOR_DELIVERY"];
const RESCHEDULE_FROM: OrderStatus[] = ["FAILED", "RETURNING", "RETURNED_TO_WAREHOUSE", "RESCHEDULED"];

export type FailureActionResult = { ok: true } | { ok: false; error: string };

/** Despacho decide que el paquete regrese a bodega. Lo sigue trayendo el repartidor que lo tiene. */
export async function sendToWarehouse(prisma: PrismaClient, orderId: string, actorUserId?: string): Promise<FailureActionResult> {
  return prisma.$transaction(async (tx) => {
    const [o] = await tx.$queryRaw<{ status: OrderStatus; code: string }[]>`SELECT status, code FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    if (!o) return { ok: false, error: "Pedido no encontrado" };
    if (!SEND_BACK_FROM.includes(o.status)) return { ok: false, error: `${o.code} no se puede mandar a bodega en su estado actual` };
    await markReturning(tx, orderId, "Regresar a bodega (decisión de despacho)", "ADMIN", actorUserId);
    return { ok: true };
  });
}

/**
 * Reprograma: vuelve a la cola de despacho sin repartidor, con fecha opcional.
 * Si estaba en bodega, se cierra su custodia (el historial queda en los eventos).
 */
export async function rescheduleOrder(
  prisma: PrismaClient,
  orderId: string,
  opts: { date?: Date; note?: string } = {},
  actorUserId?: string,
): Promise<FailureActionResult> {
  return prisma.$transaction(async (tx) => {
    const [o] = await tx.$queryRaw<{ status: OrderStatus; code: string }[]>`SELECT status, code FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    if (!o) return { ok: false, error: "Pedido no encontrado" };
    if (!RESCHEDULE_FROM.includes(o.status)) return { ok: false, error: `${o.code} no se puede reprogramar en su estado actual` };
    await tx.order.update({ where: { id: orderId }, data: { driverId: null, requestedDeliveryAt: opts.date ?? null } });
    await tx.returnCustody.deleteMany({ where: { orderId, status: { not: "RETURNED_TO_SELLER" } } });
    const when = opts.date ? ` para el ${opts.date.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}` : "";
    await addOrderEvent(tx, { orderId, type: "rescheduled", source: "ADMIN", toStatus: "RESCHEDULED", actorUserId, note: [`Reprogramado${when}`, opts.note].filter(Boolean).join(" · ") });
    return { ok: true };
  });
}

/** Paquetes no entregados que el repartidor trae consigo y debe dejar en bodega. */
export function packagesToReturn(db: Db, driverId: string) {
  return db.order.findMany({
    where: { driverId, status: { in: ["FAILED", "RETURNING"] } },
    select: { id: true, code: true, status: true, recipientName: true, addressLine: true, client: { select: { name: true } } },
    orderBy: { updatedAt: "asc" },
  });
}

/** Repartidores en turno que no han mandado ubicación en `minutes` minutos [P04]. */
export async function driversWithoutLocation(db: Db, minutes = 10, now = new Date()) {
  const limit = new Date(now.getTime() - minutes * 60_000);
  const drivers = await db.driver.findMany({
    where: { active: true, onDuty: true, OR: [{ lastLocationAt: null }, { lastLocationAt: { lt: limit } }] },
    select: { id: true, lastLocationAt: true, shiftStartedAt: true, user: { select: { name: true } } },
    orderBy: { lastLocationAt: { sort: "asc", nulls: "first" } },
  });
  // Recién iniciado el turno todavía no tiene por qué haber reportado.
  return drivers.filter((d) => d.lastLocationAt || !d.shiftStartedAt || d.shiftStartedAt < limit);
}
