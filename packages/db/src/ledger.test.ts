import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma, chargeOrder, getClientBalance, isPickupBlocked } from "./index.ts";

const tag = `t${Date.now()}`;
let clientId: string;

async function newOrder(n: number) {
  return prisma.order.create({
    data: { code: `${tag}-${n}`, source: "MANUAL", clientId, addressLine: "Calle 1" },
  });
}

beforeAll(async () => {
  const c = await prisma.client.create({
    data: { publicId: tag, name: "Test", paymentReference: tag, tariffAmount: 85 },
  });
  clientId = c.id;
});

afterAll(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("libro mayor", () => {
  it("cobra una sola vez aunque se escanee dos veces (incluso en paralelo)", async () => {
    const o = await newOrder(1);
    await Promise.all([chargeOrder(prisma, o.id), chargeOrder(prisma, o.id), chargeOrder(prisma, o.id)]);
    const n = await prisma.ledgerEntry.count({ where: { orderId: o.id, type: "CHARGE" } });
    expect(n).toBe(1);
    expect((await getClientBalance(prisma, clientId)).toString()).toBe("85");
  });

  it("los abonos reducen el saldo y desbloquean recolecciones", async () => {
    expect(await isPickupBlocked(prisma, clientId)).toBe(true);
    await prisma.ledgerEntry.create({
      data: { clientId, type: "PAYMENT", amount: new Prisma.Decimal(-85), description: "Abono" },
    });
    expect((await getClientBalance(prisma, clientId)).toString()).toBe("0");
    expect(await isPickupBlocked(prisma, clientId)).toBe(false);
  });

  it("la exención temporal permite recolectar aunque deba", async () => {
    const o = await newOrder(2);
    await chargeOrder(prisma, o.id);
    expect(await isPickupBlocked(prisma, clientId)).toBe(true);
    await prisma.client.update({
      where: { id: clientId },
      data: { pickupExemptUntil: new Date(Date.now() + 86_400_000) },
    });
    expect(await isPickupBlocked(prisma, clientId)).toBe(false);
  });

  it("no cobra si el cobro está deshabilitado", async () => {
    await prisma.client.update({ where: { id: clientId }, data: { chargingEnabled: false } });
    const o = await newOrder(3);
    expect(await chargeOrder(prisma, o.id)).toBeNull();
  });
});
