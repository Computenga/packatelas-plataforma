// Cierre manual desde administración: marcar entregado / no entregado un envío o una recolección
// (cuando el repartidor no pudo hacerlo en la app), y cancelar recolecciones repetidas.
// Todo queda en el historial con quién lo hizo y por qué.
import { completeReturnOrder } from "./returns.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { addOrderEvent, audit } from "./orders.ts";
import { FAIL_REASONS, type FailReason } from "./dispatch.ts";
import { getMaxAttempts, markReturning } from "./failures.ts";
import { reconcileCustody } from "./custody.ts";
import { ensurePickupOrder } from "./pickups.ts";
import { storeOrdersAfterPickup } from "./store.ts";

const OPEN_DELIVERY = ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED", "RESCHEDULED"];

/** Envío (no recolección): entregado o no entregado, marcado por un administrador. */
export async function adminMarkOrder(
  prisma: PrismaClient,
  orderId: string,
  input: { outcome: "delivered" | "failed"; note: string; receiverName?: string; reason?: FailReason },
  actorUserId: string,
) {
  const note = input.note.trim();
  if (note.length < 3) throw new Error("Escribe por qué se marca a mano (queda en el historial)");
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, kind: true, status: true, code: true, pickupId: true } });
  if (!order) throw new Error("Pedido no encontrado");
  if (order.kind === "PICKUP" && order.pickupId) return adminMarkPickup(prisma, order.pickupId, { collected: input.outcome === "delivered", note }, actorUserId);
  if (!OPEN_DELIVERY.includes(order.status)) throw new Error("Este pedido ya está cerrado");
  return prisma.$transaction(async (tx) => {
    if (input.outcome === "delivered") {
      await addOrderEvent(tx, {
        orderId, type: "delivered", source: "ADMIN", toStatus: "DELIVERED", actorUserId,
        note: `Marcado entregado a mano: ${note}${input.receiverName ? ` · Recibió: ${input.receiverName}` : ""}`, data: { manual: true },
      });
      await tx.order.update({ where: { id: orderId }, data: { attempts: { increment: 1 } } });
      await reconcileCustody(tx, orderId);
      if (order.kind === "RETURN") await completeReturnOrder(tx, orderId, actorUserId, input.receiverName);
    } else {
      const reason = input.reason && input.reason in FAIL_REASONS ? input.reason : "otro";
      await addOrderEvent(tx, { orderId, type: "failed", source: "ADMIN", toStatus: "FAILED", actorUserId, note: `Marcado no entregado a mano: ${FAIL_REASONS[reason]} · ${note}`, data: { reason, manual: true } });
      const u = await tx.order.update({ where: { id: orderId }, data: { attempts: { increment: 1 } } });
      if (order.kind !== "RETURN" && (reason === "rechazo" || u.attempts >= (await getMaxAttempts(tx)))) {
        await markReturning(tx, orderId, `Llevar a bodega: ${reason === "rechazo" ? "el cliente lo rechazó" : `${u.attempts} intento(s) sin entregar`}`, "ADMIN", actorUserId);
      }
    }
    await audit(tx, { actorUserId, action: `order.manual_${input.outcome}`, entity: "Order", entityId: orderId, summary: `${order.code} marcado ${input.outcome === "delivered" ? "entregado" : "no entregado"} a mano: ${note}` });
    return { ok: true as const };
  });
}

/** Recolección: recolectada o fallida, marcada por un administrador (sin exigir fotos). */
export async function adminMarkPickup(prisma: PrismaClient, pickupId: string, input: { collected: boolean; count?: number; note: string }, actorUserId: string) {
  const note = input.note.trim();
  if (note.length < 3) throw new Error("Escribe por qué se marca a mano (queda en el historial)");
  const p = await prisma.pickup.findUnique({ where: { id: pickupId } });
  if (!p) throw new Error("Recolección no encontrada");
  if (!["SCHEDULED", "ASSIGNED", "BLOCKED", "FAILED"].includes(p.status)) throw new Error("Esta recolección ya está cerrada");
  const count = input.collected && input.count && Number.isInteger(input.count) && input.count > 0 ? Math.min(input.count, 5000) : null;
  const order = await ensurePickupOrder(prisma, p.id);
  await prisma.pickup.update({
    where: { id: p.id },
    data: { status: input.collected ? "COLLECTED" : "FAILED", collectedCount: input.collected ? count : 0, collectedAt: new Date(), note: [p.note, `A mano: ${note}`].filter(Boolean).join(" · ").slice(0, 300) },
  });
  await addOrderEvent(prisma, {
    orderId: order.id, type: input.collected ? "picked_up" : "pickup_failed", source: "ADMIN", toStatus: input.collected ? "DELIVERED" : "FAILED", actorUserId,
    note: input.collected ? `Recolectada (marcada a mano)${count ? `: ${count} paquete(s)` : ""} · ${note}` : `No se pudo recolectar (marcada a mano) · ${note}`,
    data: { manual: true, ...(count ? { count } : {}) },
  });
  await audit(prisma, { actorUserId, action: input.collected ? "pickup.manual_collected" : "pickup.manual_failed", entity: "Pickup", entityId: p.id, summary: `${order.code} marcada ${input.collected ? "recolectada" : "fallida"} a mano: ${note}` });
  await storeOrdersAfterPickup(prisma, p.id, input.collected).catch(() => 0);
  return { ok: true as const };
}

/** Cancela una recolección (p. ej. repetida). No se puede si ya se recolectó. */
export async function cancelPickup(prisma: PrismaClient, pickupId: string, reason: string, actorUserId: string) {
  const p = await prisma.pickup.findUnique({ where: { id: pickupId }, include: { order: { select: { id: true, code: true } } } });
  if (!p) throw new Error("Recolección no encontrada");
  if (p.status === "COLLECTED") throw new Error("Ya se recolectó; no se puede cancelar");
  if (p.status === "CANCELLED") return { ok: true as const };
  await prisma.pickup.update({ where: { id: p.id }, data: { status: "CANCELLED", note: [p.note, `Cancelada: ${reason}`].filter(Boolean).join(" · ").slice(0, 300) } });
  if (p.order) await addOrderEvent(prisma, { orderId: p.order.id, type: "cancelled", source: "ADMIN", toStatus: "CANCELLED", actorUserId, note: reason });
  await audit(prisma, { actorUserId, action: "pickup.cancelled", entity: "Pickup", entityId: p.id, summary: `Recolección ${p.order?.code ?? p.id} cancelada: ${reason}` });
  await storeOrdersAfterPickup(prisma, p.id, false).catch(() => 0); // insumos pasan a la siguiente
  return { ok: true as const };
}
