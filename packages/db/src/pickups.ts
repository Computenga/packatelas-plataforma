// Recolecciones [A06, R09, C05, F07].
import type { PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { isPickupBlocked } from "./ledger.ts";

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
      await tx.pickup.create({
        data: { clientId: b.clientId, branchId: b.id, scheduledFor: date, automatic: true, status: blocked ? "BLOCKED" : "SCHEDULED" },
      });
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
  await prisma.pickup.updateMany({
    where: { clientId, scheduledFor: { gte: dateOnly(todayMx()) }, status: blocked ? "SCHEDULED" : "BLOCKED" },
    data: { status: blocked ? "BLOCKED" : "SCHEDULED" },
  });
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
  const p = await prisma.pickup.findUniqueOrThrow({ where: { id: pickupId } });
  if (p.status === "BLOCKED") throw new Error("Recolección bloqueada por adeudo");
  if (["COLLECTED", "CANCELLED", "FAILED"].includes(p.status)) throw new Error("Esta recolección ya se cerró");
  await prisma.pickup.update({ where: { id: pickupId }, data: { driverId, status: driverId ? "ASSIGNED" : "SCHEDULED" } });
  await audit(prisma, { actorUserId, action: "pickup.assigned", entity: "Pickup", entityId: pickupId, summary: driverId ? "Recolección asignada" : "Recolección desasignada" });
}

/** El repartidor confirma (con número de paquetes) o reporta que no pudo recolectar [R09]. */
export async function completePickup(
  prisma: PrismaClient,
  input: { pickupId: string; driverId: string; collected: boolean; count?: number; note?: string },
  actorUserId?: string,
) {
  const p = await prisma.pickup.findUniqueOrThrow({ where: { id: input.pickupId } });
  if (p.driverId !== input.driverId) throw new Error("Esta recolección no está asignada a ti");
  if (p.status !== "ASSIGNED") throw new Error("Esta recolección no está activa");
  if (input.collected && (!Number.isInteger(input.count) || input.count! < 1 || input.count! > 5000)) {
    throw new Error("Indica cuántos paquetes recibiste");
  }
  const done = await prisma.pickup.update({
    where: { id: p.id },
    data: {
      status: input.collected ? "COLLECTED" : "FAILED",
      collectedCount: input.collected ? input.count : 0,
      collectedAt: new Date(),
      note: input.note ?? p.note,
    },
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
