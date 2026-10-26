// Abonos manuales, ajustes y exenciones [F03, F06, F07].
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { refreshBlockedPickups } from "./pickups.ts";

export async function registerManualPayment(
  prisma: PrismaClient,
  input: { clientId: string; amount: number; receivedAt: Date; method: "TRANSFER" | "CASH" | "OTHER"; reference?: string; note?: string },
  actorUserId?: string,
) {
  if (!(input.amount > 0) || input.amount > 1_000_000) throw new Error("Monto inválido");
  const amount = new Prisma.Decimal(input.amount.toFixed(2));
  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId } });
    const payment = await tx.payment.create({
      data: {
        clientId: client.id,
        method: input.method,
        source: "MANUAL",
        status: "APPLIED",
        amount,
        reference: input.reference,
        note: input.note,
        receivedAt: input.receivedAt,
        appliedById: actorUserId,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        clientId: client.id,
        type: "PAYMENT",
        amount: amount.neg(),
        description: `Abono ${input.method === "CASH" ? "en efectivo" : "manual"}${input.reference ? ` · ${input.reference}` : ""}`,
        paymentId: payment.id,
        createdById: actorUserId,
      },
    });
    await audit(tx, {
      actorUserId,
      action: "payment.manual",
      entity: "Payment",
      entityId: payment.id,
      summary: `Abono manual de $${amount.toFixed(2)} a ${client.name}`,
    });
    return payment;
  });
  await refreshBlockedPickups(prisma, input.clientId);
  return result;
}

/** Ajuste de saldo: positivo = cargo adicional, negativo = bonificación. Requiere motivo. */
export async function addAdjustment(prisma: PrismaClient, clientId: string, amount: number, description: string, actorUserId?: string) {
  if (!amount || Math.abs(amount) > 1_000_000) throw new Error("Monto inválido");
  if (description.trim().length < 3) throw new Error("Escribe el motivo del ajuste");
  const value = new Prisma.Decimal(amount.toFixed(2));
  await prisma.$transaction(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
    const entry = await tx.ledgerEntry.create({
      data: { clientId, type: "ADJUSTMENT", amount: value, description: `Ajuste · ${description.trim()}`, createdById: actorUserId },
    });
    await audit(tx, {
      actorUserId,
      action: "ledger.adjustment",
      entity: "LedgerEntry",
      entityId: entry.id,
      summary: `Ajuste de $${value.toFixed(2)} a ${client.name}: ${description.trim()}`,
    });
  });
  await refreshBlockedPickups(prisma, clientId);
}

/** Exención temporal del bloqueo de recolecciones por adeudo; `until` null la retira. */
export async function setPickupExemption(prisma: PrismaClient, clientId: string, until: Date | null, note: string | undefined, actorUserId?: string) {
  const client = await prisma.client.update({
    where: { id: clientId },
    data: { pickupExemptUntil: until, pickupExemptNote: until ? note ?? null : null },
  });
  await audit(prisma, {
    actorUserId,
    action: "client.pickup_exemption",
    entity: "Client",
    entityId: clientId,
    summary: until
      ? `Exención de recolección para ${client.name} hasta ${until.toISOString().slice(0, 10)}${note ? ` (${note})` : ""}`
      : `Se retiró la exención de recolección de ${client.name}`,
  });
  await refreshBlockedPickups(prisma, clientId);
}

/** Aplica a un cliente un pago que llegó sin referencia reconocible [F05]. */
export async function applyUnidentifiedPayment(prisma: PrismaClient, paymentId: string, clientId: string, actorUserId?: string) {
  await prisma.$transaction(async (tx) => {
    // Candado de fila: dos personas aplicando el mismo pago a la vez no lo duplican.
    const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    if (!row) throw new Error("Pago no encontrado");
    if (row.status !== "UNIDENTIFIED") throw new Error("Este pago ya fue aplicado");
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
    await tx.payment.update({ where: { id: p.id }, data: { clientId, status: "APPLIED", appliedById: actorUserId } });
    await tx.ledgerEntry.create({
      data: {
        clientId,
        type: "PAYMENT",
        amount: p.amount.neg(),
        description: `Abono ${p.reference ? `· ${p.reference}` : "por transferencia"}`,
        paymentId: p.id,
        createdById: actorUserId,
      },
    });
    if (p.fee.gt(0)) {
      await tx.ledgerEntry.create({ data: { clientId, type: "FEE", amount: p.fee, description: "Comisión por pago", paymentId: p.id, createdById: actorUserId } });
    }
    await audit(tx, {
      actorUserId,
      action: "payment.applied",
      entity: "Payment",
      entityId: p.id,
      summary: `Pago sin identificar de $${p.amount.toFixed(2)} aplicado a ${client.name}`,
    });
  });
  await refreshBlockedPickups(prisma, clientId);
}
