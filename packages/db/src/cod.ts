// Pago contra entrega: el repartidor cobra en efectivo, lo entrega en oficina y Packatelas se lo
// transfiere a la tienda (sin comisión; no toca el saldo de envíos de la tienda).
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;
const money = (n: number) => Math.round(n * 100) / 100;
const num = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d.toString()));
export const mxnText = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const collected = { codCollectedAt: { not: null }, codCollected: { gt: 0 } } as const;

/** Efectivo que cada repartidor cobró y todavía no entrega en oficina. */
export async function codCashByDriver(db: Db) {
  const rows = await db.order.findMany({
    where: { ...collected, codHandedAt: null },
    select: { id: true, code: true, codCollected: true, codCollectedAt: true, recipientName: true, driverId: true, client: { select: { name: true } }, driver: { select: { user: { select: { name: true } } } } },
    orderBy: { codCollectedAt: "asc" },
  });
  const by = new Map<string, { driverId: string | null; name: string; total: number; orders: typeof rows }>();
  for (const r of rows) {
    const k = r.driverId ?? "-";
    const g = by.get(k) ?? { driverId: r.driverId, name: r.driver?.user.name ?? "Sin repartidor", total: 0, orders: [] };
    g.total = money(g.total + num(r.codCollected));
    g.orders.push(r);
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

/** Oficina recibe el efectivo de un repartidor (todo lo pendiente, o los pedidos indicados). */
export async function receiveDriverCash(prisma: PrismaClient, driverId: string, actorUserId: string, orderIds?: string[]) {
  return prisma.$transaction(async (tx) => {
    const where = { ...collected, codHandedAt: null, driverId, ...(orderIds ? { id: { in: orderIds } } : {}) };
    const list = await tx.order.findMany({ where, select: { id: true, code: true, codCollected: true } });
    if (!list.length) throw new Error("Este repartidor no tiene efectivo pendiente de entregar");
    const total = money(list.reduce((s, o) => s + num(o.codCollected), 0));
    const n = await tx.order.updateMany({ where: { ...where, id: { in: list.map((o) => o.id) } }, data: { codHandedAt: new Date(), codHandedById: actorUserId } });
    if (n.count !== list.length) throw new Error("Alguien más registró este efectivo al mismo tiempo; vuelve a cargar la página");
    const drv = await tx.driver.findUnique({ where: { id: driverId }, select: { user: { select: { name: true } } } });
    await audit(tx, { actorUserId, action: "cod.cash_received", entity: "Driver", entityId: driverId, summary: `Efectivo contra entrega recibido de ${drv?.user.name ?? "repartidor"}: ${mxnText(total)} (${list.length} pedido(s))`, data: { codes: list.map((o) => o.code), total } });
    return { count: list.length, total };
  });
}

/** Cobrado y aún no transferido a la tienda, agrupado por tienda. */
export async function codPendingByClient(db: Db) {
  const rows = await db.order.findMany({
    where: { ...collected, codPayoutId: null },
    select: { id: true, code: true, clientId: true, codCollected: true, codCollectedAt: true, codHandedAt: true, recipientName: true, client: { select: { name: true, publicId: true } } },
    orderBy: { codCollectedAt: "asc" },
  });
  const by = new Map<string, { clientId: string; name: string; total: number; inOffice: number; orders: typeof rows }>();
  for (const r of rows) {
    const g = by.get(r.clientId) ?? { clientId: r.clientId, name: r.client.name, total: 0, inOffice: 0, orders: [] };
    g.total = money(g.total + num(r.codCollected));
    if (r.codHandedAt) g.inOffice = money(g.inOffice + num(r.codCollected));
    g.orders.push(r);
    by.set(r.clientId, g);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

/** Registra la transferencia a la tienda con los pedidos que liquida (por defecto, todo lo pendiente). */
export async function createCodPayout(
  prisma: PrismaClient,
  input: { clientId: string; reference: string; paidAt: Date; note?: string; orderIds?: string[] },
  actorUserId: string,
) {
  const reference = input.reference.trim();
  if (reference.length < 3) throw new Error("Escribe la referencia o clave de rastreo de la transferencia");
  return prisma.$transaction(async (tx) => {
    const where = { ...collected, codPayoutId: null, clientId: input.clientId, ...(input.orderIds ? { id: { in: input.orderIds } } : {}) };
    const list = await tx.order.findMany({ where, select: { id: true, code: true, codCollected: true } });
    if (!list.length) throw new Error("No hay cobros pendientes de transferir a esta tienda");
    const amount = money(list.reduce((s, o) => s + num(o.codCollected), 0));
    const payout = await tx.codPayout.create({ data: { clientId: input.clientId, amount: amount.toFixed(2), reference: reference.slice(0, 100), paidAt: input.paidAt, note: input.note?.trim().slice(0, 300) || null, createdById: actorUserId } });
    const n = await tx.order.updateMany({ where: { ...where, id: { in: list.map((o) => o.id) } }, data: { codPayoutId: payout.id } });
    if (n.count !== list.length) throw new Error("Alguien más registró esta transferencia al mismo tiempo; vuelve a cargar la página");
    const c = await tx.client.findUnique({ where: { id: input.clientId }, select: { name: true } });
    await audit(tx, { actorUserId, action: "cod.payout", entity: "Client", entityId: input.clientId, summary: `Transferencia de cobros contra entrega a ${c?.name ?? "tienda"}: ${mxnText(amount)} (${list.length} pedido(s)) · ref. ${reference}`, data: { payoutId: payout.id, codes: list.map((o) => o.code), amount } });
    return { id: payout.id, amount, count: list.length };
  });
}

/** Lo que ve la tienda: cobrado por transferir, por cobrar en ruta y transferencias recibidas. */
export async function clientCodSummary(db: Db, clientId: string) {
  const [pending, inRoute, payouts] = await Promise.all([
    db.order.findMany({ where: { clientId, ...collected, codPayoutId: null }, select: { id: true, code: true, recipientName: true, codCollected: true, codCollectedAt: true }, orderBy: { codCollectedAt: "desc" } }),
    db.order.aggregate({ where: { clientId, codAmount: { gt: 0 }, codCollectedAt: null, status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED_TO_SELLER", "RETURNED_TO_WAREHOUSE"] } }, _sum: { codAmount: true }, _count: true }),
    db.codPayout.findMany({ where: { clientId }, orderBy: { paidAt: "desc" }, take: 50, include: { orders: { select: { id: true, code: true, recipientName: true, codCollected: true }, orderBy: { code: "asc" } } } }),
  ]);
  return {
    pending,
    pendingTotal: money(pending.reduce((s, o) => s + num(o.codCollected), 0)),
    inRouteCount: inRoute._count,
    inRouteTotal: num(inRoute._sum.codAmount),
    payouts,
  };
}
