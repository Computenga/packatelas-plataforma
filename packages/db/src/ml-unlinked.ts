// Vendedores de ML que aún no están ligados a ningún cliente: sus paquetes se registran en una
// cuenta interna para poder llevarlos y entregarlos con evidencia. Al ligar al vendedor con su
// cliente, sus envíos pasan a ese cliente y se le cobran.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { chargeOrder } from "./ledger.ts";

type Db = PrismaClient | Prisma.TransactionClient;
export const UNLINKED_PUBLIC_ID = "mlporidentificar";

export async function unlinkedMlClient(db: Db) {
  const found = await db.client.findUnique({ where: { publicId: UNLINKED_PUBLIC_ID } });
  if (found) return found;
  return db.client.upsert({
    where: { publicId: UNLINKED_PUBLIC_ID },
    update: {},
    create: { publicId: UNLINKED_PUBLIC_ID, name: "ML por identificar (vendedor sin ligar)", paymentReference: "MLPORIDENTIFICAR", tariffAmount: 0 },
  });
}

/** Al ligar la cuenta a su cliente: sus envíos de «ML por identificar» pasan a él y se le cobran. */
export async function claimUnlinkedOrders(db: Db, mlAccountId: string, clientId: string, actorUserId?: string) {
  const holder = await db.client.findUnique({ where: { publicId: UNLINKED_PUBLIC_ID }, select: { id: true } });
  if (!holder || holder.id === clientId) return 0;
  const branch = await db.branch.findFirst({ where: { clientId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const orders = await db.order.findMany({ where: { mlAccountId, clientId: holder.id }, select: { id: true } });
  for (const o of orders) {
    await db.order.update({ where: { id: o.id }, data: { clientId, ...(branch ? { branchId: branch.id } : {}) } });
    await chargeOrder(db, o.id, actorUserId);
  }
  return orders.length;
}
