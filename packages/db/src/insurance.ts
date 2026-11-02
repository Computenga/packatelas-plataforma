// Seguro por pérdida o daño [A36]: un administrador fija cuánto se le reembolsa a la tienda por un envío
// y se abona a su saldo como movimiento «Seguro». Un solo seguro por envío (el libro mayor lo impide dos veces).
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { addOrderEvent, audit } from "./orders.ts";
import { refreshBlockedPickups } from "./pickups.ts";
import { notifyClient } from "./client-push.ts";

export const INSURANCE_REASONS = [
  { key: "perdida", label: "Pérdida" },
  { key: "dano", label: "Daño" },
  { key: "robo", label: "Robo" },
  { key: "otro", label: "Otro" },
] as const;
export type InsuranceReason = (typeof INSURANCE_REASONS)[number]["key"];

const MAX = 50_000;
const money = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

export async function applyInsurance(
  prisma: PrismaClient,
  input: { orderId: string; amount: number; reason: InsuranceReason; note: string },
  actorUserId?: string,
) {
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0) || amount > MAX) throw new Error(`Monto inválido (de $1 a ${money(MAX)})`);
  const reason = INSURANCE_REASONS.find((r) => r.key === input.reason);
  if (!reason) throw new Error("Elige el motivo");
  const note = input.note.trim();
  if (note.length < 5) throw new Error("Describe brevemente qué pasó (mínimo 5 letras)");

  const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { id: true, code: true, clientId: true, client: { select: { name: true } } } });
  if (!order) throw new Error("Pedido no encontrado");
  const already = await prisma.ledgerEntry.findFirst({ where: { orderId: order.id, type: "INSURANCE" }, select: { id: true } });
  if (already) throw new Error("Este envío ya tiene un seguro aplicado");

  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.ledgerEntry.create({
      data: {
        clientId: order.clientId,
        type: "INSURANCE",
        amount: new Prisma.Decimal((-amount).toFixed(2)), // abono: reduce lo que debe
        description: `Seguro por ${reason.label.toLowerCase()} · ${order.code} · ${note}`.slice(0, 300),
        orderId: order.id,
        createdById: actorUserId,
      },
    });
    await addOrderEvent(tx, { orderId: order.id, type: "insurance", source: "ADMIN", actorUserId, note: `Seguro aplicado: ${money(amount)} por ${reason.label.toLowerCase()}. ${note}`, data: { amount, reason: reason.key } });
    await audit(tx, { actorUserId, action: "ledger.insurance", entity: "LedgerEntry", entityId: e.id, summary: `Seguro de ${money(amount)} a ${order.client.name} por ${order.code} (${reason.label}): ${note}` });
    return e;
  });
  await refreshBlockedPickups(prisma, order.clientId).catch(() => {});
  await notifyClient(prisma, order.clientId, "pago", {
    title: "Seguro aplicado a tu saldo",
    body: `Abonamos ${money(amount)} a tu saldo por ${reason.label.toLowerCase()} del envío ${order.code}.`,
    url: `/cliente/envio/${order.id}`,
  }).catch(() => 0);
  return entry;
}
