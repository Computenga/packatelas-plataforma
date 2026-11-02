import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, applyInsurance, getClientBalance } from "./index.ts";

const tag = `ins${Date.now()}`;
let clientId: string;
let orderId: string;

beforeAll(async () => {
  const c = await prisma.client.create({ data: { publicId: tag, name: "Test seguro", paymentReference: tag, tariffAmount: 85 } });
  clientId = c.id;
  orderId = (await prisma.order.create({ data: { code: `${tag}-1`, source: "MANUAL", clientId, addressLine: "Calle 1" } })).id;
});

afterAll(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("seguro por pérdida o daño [A36]", () => {
  it("valida monto y motivo", async () => {
    await expect(applyInsurance(prisma, { orderId, amount: 0, reason: "perdida", note: "se perdió" })).rejects.toThrow(/Monto/);
    await expect(applyInsurance(prisma, { orderId, amount: 100, reason: "perdida", note: "x" })).rejects.toThrow(/Describe/);
  });

  it("abona al saldo una sola vez y deja rastro en el pedido", async () => {
    await applyInsurance(prisma, { orderId, amount: 349.9, reason: "dano", note: "Llegó roto" });
    expect((await getClientBalance(prisma, clientId)).toString()).toBe("-349.9");
    await expect(applyInsurance(prisma, { orderId, amount: 10, reason: "dano", note: "Otra vez" })).rejects.toThrow(/ya tiene/);
    expect(await prisma.orderEvent.count({ where: { orderId, type: "insurance" } })).toBe(1);
  });
});
