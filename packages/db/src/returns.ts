// Devoluciones con cadena de custodia de dos escaneos [A10, R13]:
// 1) el paquete no entregado se recibe en Packatelas, 2) se devuelve al vendedor.
import type { PrismaClient, OrderStatus } from "../generated/prisma/client.ts";
import { addOrderEvent } from "./orders.ts";
import { parseScan } from "./scan.ts";

/** Pedidos que pueden entrar al almacén como devolución. */
const RECEIVABLE: OrderStatus[] = ["FAILED", "RETURNING", "CANCELLED", "OUT_FOR_DELIVERY", "ASSIGNED", "RESCHEDULED"];

export type ReturnOutcome =
  | { status: "ok" | "already"; orderId: string; code: string; clientName: string }
  | { status: "error"; message: string };

async function findByScan(prisma: PrismaClient, raw: string) {
  const p = parseScan(raw);
  if (p.kind === "INVALID") return null;
  const where = p.kind === "CODE" ? { code: p.code } : { mlShipmentId: p.shipmentId };
  return prisma.order.findUnique({ where, include: { client: true, return: true, driver: { include: { user: { select: { name: true } } } } } });
}

/** Primer escaneo: el paquete llega al almacén de Packatelas. */
export async function receiveReturn(prisma: PrismaClient, raw: string, actorUserId?: string): Promise<ReturnOutcome> {
  const order = await findByScan(prisma, raw);
  if (!order) return { status: "error", message: "Paquete no encontrado en el sistema" };
  const ref = { orderId: order.id, code: order.code, clientName: order.client.name };
  if (order.return?.status === "IN_WAREHOUSE") return { status: "already", ...ref };
  if (order.return?.status === "RETURNED_TO_SELLER") return { status: "error", message: `${order.code} ya se devolvió al vendedor` };
  if (!RECEIVABLE.includes(order.status)) return { status: "error", message: `${order.code} no está pendiente de devolución` };

  await prisma.$transaction(async (tx) => {
    await tx.returnCustody.upsert({
      where: { orderId: order.id },
      update: { status: "IN_WAREHOUSE", receivedAt: new Date(), receivedById: actorUserId },
      create: { orderId: order.id, status: "IN_WAREHOUSE", receivedAt: new Date(), receivedById: actorUserId },
    });
    // Ya no lo trae el repartidor: sale de su lista de "llevar a bodega".
    if (order.driverId) await tx.order.update({ where: { id: order.id }, data: { driverId: null } });
    const from = order.driver ? ` · lo entregó ${order.driver.user.name}` : "";
    await addOrderEvent(tx, { orderId: order.id, type: "return_received", source: "SCAN", toStatus: "RETURNED_TO_WAREHOUSE", actorUserId, note: `Recibido en Packatelas${from}` });
  });
  return { status: "ok", ...ref };
}

/** Segundo escaneo: se entrega al vendedor. Exige que antes haya entrado al almacén. */
export async function returnToSeller(prisma: PrismaClient, raw: string, actorUserId?: string): Promise<ReturnOutcome> {
  const order = await findByScan(prisma, raw);
  if (!order) return { status: "error", message: "Paquete no encontrado en el sistema" };
  const ref = { orderId: order.id, code: order.code, clientName: order.client.name };
  if (order.return?.status === "RETURNED_TO_SELLER") return { status: "already", ...ref };
  if (order.return?.status !== "IN_WAREHOUSE") {
    return { status: "error", message: `${order.code} no se ha recibido en Packatelas; escanéalo primero en "Recibir"` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.returnCustody.update({
      where: { orderId: order.id },
      data: { status: "RETURNED_TO_SELLER", returnedAt: new Date(), returnedById: actorUserId },
    });
    await addOrderEvent(tx, { orderId: order.id, type: "returned_to_seller", source: "SCAN", toStatus: "RETURNED_TO_SELLER", actorUserId, note: "Devuelto al vendedor" });
  });
  return { status: "ok", ...ref };
}
