// Libro mayor de clientes [F02, F03, F06, F07].
// Cargos positivos, abonos negativos; saldo = suma. Nada se edita ni se borra.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { accountState } from "./credit.ts";

type Db = PrismaClient | Prisma.TransactionClient;

/** Saldo pendiente del cliente. Positivo = el cliente debe. */
export async function getClientBalance(db: Db, clientId: string): Promise<Prisma.Decimal> {
  const r = await db.ledgerEntry.aggregate({ where: { clientId }, _sum: { amount: true } });
  return r._sum.amount ?? new Prisma.Decimal(0);
}

/** Monto a cobrar por un pedido según la tarifa del cliente, o null si no se cobra. */
export function chargeAmountFor(
  client: { chargingEnabled: boolean; tariffAmount: Prisma.Decimal },
): Prisma.Decimal | null {
  if (!client.chargingEnabled) return null;
  if (client.tariffAmount.lte(0)) return null;
  return client.tariffAmount;
}

/**
 * Registra el cargo de un pedido al escanearlo [F02].
 * Idempotente: si el pedido ya tiene cargo, devuelve el existente sin crear otro.
 */
export async function chargeOrder(db: Db, orderId: string, actorUserId?: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { client: true },
  });
  const existing = await db.ledgerEntry.findUnique({
    where: { orderId_type: { orderId, type: "CHARGE" } },
  });
  if (existing) return existing;

  const amount = chargeAmountFor(order.client);
  if (!amount) return null;

  try {
    return await db.ledgerEntry.create({
      data: {
        clientId: order.clientId,
        type: "CHARGE",
        amount,
        description: `Envío ${order.code}`,
        orderId,
        createdById: actorUserId,
      },
    });
  } catch (e) {
    // Dos escaneos simultáneos: el índice único gana; devolvemos el que quedó.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return db.ledgerEntry.findUnique({ where: { orderId_type: { orderId, type: "CHARGE" } } });
    }
    throw e;
  }
}

/** Indica si las recolecciones del cliente deben bloquearse por adeudo [F07, F08]. */
export async function isPickupBlocked(db: Db, clientId: string, now = new Date()): Promise<boolean> {
  return (await accountState(db, clientId, now)).blocked;
}
