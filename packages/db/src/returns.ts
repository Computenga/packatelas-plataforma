// Devoluciones con cadena de custodia de dos escaneos [A10, R13]:
// 1) el paquete no entregado se recibe en Packatelas, 2) se devuelve al vendedor.
import type { Prisma, PrismaClient, OrderStatus } from "../generated/prisma/client.ts";
import { addOrderEvent, audit } from "./orders.ts";
import { parseScan } from "./scan.ts";
import { custodyEnd } from "./custody.ts";

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
export async function receiveReturn(prisma: PrismaClient, raw: string, actorUserId?: string, actorRole?: string): Promise<ReturnOutcome> {
  const order = await findByScan(prisma, raw);
  if (!order) return { status: "error", message: "Paquete no encontrado en el sistema" };
  const ref = { orderId: order.id, code: order.code, clientName: order.client.name };
  // Si está en el inventario de un repartidor, solo admin o despachador lo pueden recibir de vuelta.
  const custody = await prisma.driverCustody.findFirst({ where: { orderId: order.id, endedAt: null }, select: { id: true } });
  if (custody && actorRole && !["ADMIN", "DESPACHADOR"].includes(actorRole)) {
    return { status: "error", message: `${order.code} está en el inventario de un repartidor: lo debe recibir un admin o despachador` };
  }
  if (order.return?.status === "IN_WAREHOUSE") {
    if (custody) await custodyEnd(prisma, order.id, "RETURNED", { actorUserId, source: "SCAN" });
    return { status: "already", ...ref };
  }
  if (order.return?.status === "RETURNED_TO_SELLER") return { status: "error", message: `${order.code} ya se devolvió al vendedor` };
  if (!RECEIVABLE.includes(order.status) && !custody) return { status: "error", message: `${order.code} no está pendiente de devolución` };

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
    await custodyEnd(tx, order.id, "RETURNED", { actorUserId, source: "SCAN" });
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

// ── Órdenes de devolución (DV-00001) ──
// Se seleccionan los paquetes devueltos de una tienda (escáner/PDA, cámara o búsqueda) y se crea una
// orden de devolución: un pedido de tipo RETURN con destino la sucursal de la tienda, que el despacho
// asigna a un repartidor como cualquier pedido. Al entregarla, cada paquete queda «Devuelto al vendedor».
// No genera cargo a la tienda.

type Tx = Prisma.TransactionClient;
const CANDIDATE_STATUS: OrderStatus[] = ["FAILED", "RETURNING", "CANCELLED", "RETURNED_TO_WAREHOUSE"];
export const returnFolio = (n: number | bigint) => `DV-${String(n).padStart(5, "0")}`;

export type ReturnCandidate = { id: string; code: string; clientId: string; clientName: string; status: OrderStatus; inWarehouse: boolean; branchId: string | null; reopened?: boolean };
/** Un paquete marcado «devuelto al vendedor» a mano (sin orden DV) se puede meter a una DV durante estos días. */
const REOPEN_DAYS = 7;
const reopenSince = () => new Date(Date.now() - REOPEN_DAYS * 86_400_000);
/** Se marcó devuelto con el escáner (no con una DV) hace poco: probablemente aún no sale de bodega. */
const reopenable = (o: { returnOrderId: string | null; return: { status: string; returnedAt: Date | null } | null }) =>
  o.return?.status === "RETURNED_TO_SELLER" && !o.returnOrderId && !!o.return.returnedAt && o.return.returnedAt >= reopenSince();
export type CandidateResult = { ok: true; item: ReturnCandidate } | { ok: false; error: string };

const candSelect = {
  id: true, code: true, kind: true, status: true, clientId: true, branchId: true, returnOrderId: true,
  client: { select: { name: true } },
  return: { select: { status: true, returnedAt: true } },
  returnOrder: { select: { code: true, status: true } },
  custodies: { where: { endedAt: null }, select: { driver: { select: { user: { select: { name: true } } } } } },
} as const;

type CandRow = Prisma.OrderGetPayload<{ select: typeof candSelect }>;

function judge(o: CandRow): CandidateResult {
  if (o.kind !== "DELIVERY") return { ok: false, error: `${o.code} no es un envío` };
  if (reopenable(o)) {
    return { ok: true, item: { id: o.id, code: o.code, clientId: o.clientId, clientName: o.client.name, status: o.status, inWarehouse: false, branchId: o.branchId, reopened: true } };
  }
  if (o.return?.status === "RETURNED_TO_SELLER") return { ok: false, error: `${o.code} ya se devolvió a la tienda` };
  if (o.returnOrder && !["CANCELLED", "DELIVERED"].includes(o.returnOrder.status)) return { ok: false, error: `${o.code} ya va en la devolución ${o.returnOrder.code}` };
  const inWarehouse = o.return?.status === "IN_WAREHOUSE";
  if (!inWarehouse && !CANDIDATE_STATUS.includes(o.status)) return { ok: false, error: `${o.code} no está cancelado, fallido ni en bodega` };
  if (!inWarehouse && o.custodies[0]) return { ok: false, error: `${o.code} lo tiene ${o.custodies[0].driver.user.name}: recíbelo primero en bodega` };
  return { ok: true, item: { id: o.id, code: o.code, clientId: o.clientId, clientName: o.client.name, status: o.status, inWarehouse, branchId: o.branchId } };
}

/** Un paquete escaneado (QR de ML o código PK) o elegido por id: ¿se puede devolver? */
export async function returnCandidate(prisma: PrismaClient, input: { raw?: string; orderId?: string }): Promise<CandidateResult> {
  let o: CandRow | null = null;
  if (input.orderId) o = await prisma.order.findUnique({ where: { id: input.orderId }, select: candSelect });
  else {
    const p = parseScan(input.raw ?? "");
    if (p.kind === "INVALID") return { ok: false, error: "No se reconoce el código" };
    o = await prisma.order.findUnique({ where: p.kind === "CODE" ? { code: p.code } : { mlShipmentId: p.shipmentId }, select: candSelect });
  }
  if (!o) return { ok: false, error: "Paquete no encontrado en el sistema" };
  return judge(o);
}

/** Búsqueda en el histórico: paquetes que se pueden devolver (por código, tienda o número de cliente). */
export async function searchReturnCandidates(prisma: PrismaClient, q: string, clientId?: string) {
  const t = q.trim();
  const rows = await prisma.order.findMany({
    where: {
      kind: "DELIVERY",
      ...(clientId ? { clientId } : {}),
      OR: [
        { status: { in: CANDIDATE_STATUS }, NOT: { return: { status: "RETURNED_TO_SELLER" } } },
        { return: { status: "IN_WAREHOUSE" } },
        { returnOrderId: null, return: { status: "RETURNED_TO_SELLER", returnedAt: { gte: reopenSince() } } },
      ],
      ...(t ? { AND: [{ OR: [{ code: { contains: t, mode: "insensitive" } }, { client: { name: { contains: t, mode: "insensitive" } } }, { client: { publicId: { contains: t.toLowerCase() } } }, { recipientName: { contains: t, mode: "insensitive" } }] }] } : {}),
    },
    select: candSelect,
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return rows.map(judge).filter((r): r is { ok: true; item: ReturnCandidate } => r.ok).map((r) => r.item);
}

/** Crea la orden de devolución con los paquetes elegidos (todos de la misma tienda). */
export async function createReturnOrder(prisma: PrismaClient, input: { orderIds: string[]; branchId?: string; note?: string }, actorUserId: string) {
  const ids = [...new Set(input.orderIds)].slice(0, 300);
  if (!ids.length) throw new Error("Selecciona al menos un paquete");
  const rows = await prisma.order.findMany({ where: { id: { in: ids } }, select: candSelect });
  if (rows.length !== ids.length) throw new Error("Algún paquete ya no existe; recarga la página");
  const judged = rows.map(judge);
  const bad = judged.find((j) => !j.ok);
  if (bad && !bad.ok) throw new Error(bad.error);
  const items = judged.map((j) => (j as { ok: true; item: ReturnCandidate }).item);
  const clientId = items[0].clientId;
  if (items.some((i) => i.clientId !== clientId)) throw new Error("Todos los paquetes deben ser de la misma tienda");

  const branches = await prisma.branch.findMany({ where: { clientId, active: true }, orderBy: { createdAt: "asc" } });
  const mostUsed = [...items.reduce((m, i) => (i.branchId ? m.set(i.branchId, (m.get(i.branchId) ?? 0) + 1) : m), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0];
  const branch = input.branchId ? branches.find((b) => b.id === input.branchId) : (branches.find((b) => b.id === mostUsed) ?? branches[0]);
  if (!branch) throw new Error(input.branchId ? "Esa sucursal no es de esta tienda" : "La tienda no tiene sucursal activa para entregarle");
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, contactName: true, phone: true } });

  const dv = await prisma.$transaction(async (tx: Tx) => {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('return_folio_seq') AS n`;
    const code = returnFolio(n);
    const order = await tx.order.create({
      data: {
        code, source: "MANUAL", kind: "RETURN", status: "CREATED", clientId, branchId: branch.id,
        recipientName: client.contactName || client.name, recipientPhone: branch.phone || client.phone,
        addressLine: branch.address, lat: branch.lat, lng: branch.lng,
        itemsSummary: `Devolución de ${items.length} paquete(s): ${items.map((i) => i.code).join(", ")}`.slice(0, 2000),
        instructions: input.note?.trim().slice(0, 500) || "Entregar a la tienda los paquetes devueltos; pedir nombre de quien recibe y foto.",
      },
    });
    await addOrderEvent(tx, { orderId: order.id, type: "created", source: "ADMIN", actorUserId, note: `Orden de devolución con ${items.length} paquete(s) para ${branch.name}` });
    for (const it of items) {
      if (!it.inWarehouse) {
        await tx.returnCustody.upsert({
          where: { orderId: it.id },
          update: it.reopened
            ? { status: "IN_WAREHOUSE", returnedAt: null, returnedById: null }
            : { status: "IN_WAREHOUSE", receivedAt: new Date(), receivedById: actorUserId },
          create: { orderId: it.id, status: "IN_WAREHOUSE", receivedAt: new Date(), receivedById: actorUserId },
        });
        await addOrderEvent(tx, {
          orderId: it.id, type: "return_received", source: "ADMIN", toStatus: "RETURNED_TO_WAREHOUSE", actorUserId,
          note: it.reopened ? `Estaba marcado «devuelto al vendedor» sin orden; vuelve a bodega para ir en ${code}` : `Recibido en Packatelas al crear ${code}`,
        });
      }
      await tx.order.update({ where: { id: it.id }, data: { returnOrderId: order.id } });
      await addOrderEvent(tx, { orderId: it.id, type: "return_order", source: "ADMIN", actorUserId, note: `Va a la tienda en la orden de devolución ${code}` });
    }
    return order;
  });
  await audit(prisma, { actorUserId, action: "return_order.created", entity: "Order", entityId: dv.id, summary: `${dv.code} para ${client.name}: ${items.length} paquete(s)` });
  return dv;
}

/** Al entregar la orden DV: cada paquete queda devuelto al vendedor. Idempotente. */
export async function completeReturnOrder(tx: Tx, returnOrderId: string, actorUserId?: string | null, receiverName?: string) {
  const dv = await tx.order.findUnique({ where: { id: returnOrderId }, select: { code: true, kind: true, returnItems: { select: { id: true, return: { select: { status: true } } } } } });
  if (!dv || dv.kind !== "RETURN") return 0;
  let n = 0;
  for (const it of dv.returnItems) {
    if (it.return?.status === "RETURNED_TO_SELLER") continue;
    await tx.returnCustody.upsert({
      where: { orderId: it.id },
      update: { status: "RETURNED_TO_SELLER", returnedAt: new Date(), returnedById: actorUserId ?? undefined },
      create: { orderId: it.id, status: "RETURNED_TO_SELLER", receivedAt: new Date(), returnedAt: new Date(), returnedById: actorUserId ?? undefined },
    });
    await addOrderEvent(tx, { orderId: it.id, type: "returned_to_seller", source: "SYSTEM", toStatus: "RETURNED_TO_SELLER", actorUserId, note: `Devuelto a la tienda en ${dv.code}${receiverName ? ` · Recibió: ${receiverName}` : ""}` });
    n++;
  }
  return n;
}

/** Cancela una orden de devolución no entregada: los paquetes vuelven a quedar libres en bodega. */
export async function cancelReturnOrder(prisma: PrismaClient, returnOrderId: string, reason: string, actorUserId: string) {
  const dv = await prisma.order.findUnique({ where: { id: returnOrderId }, select: { id: true, code: true, kind: true, status: true } });
  if (!dv || dv.kind !== "RETURN") throw new Error("Orden de devolución no encontrada");
  if (["DELIVERED", "CANCELLED"].includes(dv.status)) throw new Error("Esta orden ya está cerrada");
  if (reason.trim().length < 3) throw new Error("Escribe el motivo");
  await prisma.$transaction(async (tx: Tx) => {
    await addOrderEvent(tx, { orderId: dv.id, type: "cancelled", source: "ADMIN", toStatus: "CANCELLED", actorUserId, note: `Orden de devolución cancelada: ${reason.trim()}` });
    await tx.order.update({ where: { id: dv.id }, data: { driverId: null } });
    await tx.driverCustody.updateMany({ where: { orderId: dv.id, endedAt: null }, data: { endedAt: new Date(), endReason: "RETURNED", endedById: actorUserId } });
    await tx.order.updateMany({ where: { returnOrderId: dv.id }, data: { returnOrderId: null } });
  });
  await audit(prisma, { actorUserId, action: "return_order.cancelled", entity: "Order", entityId: dv.id, summary: `${dv.code} cancelada: ${reason.trim()}` });
}
