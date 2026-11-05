import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buyerDates, buyerNote, buyerReschedule, buyerVerify, createManualOrder, prisma } from "./index.ts";

const tag = `by${Date.now()}`;
let clientId: string, orderId: string;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Tienda BY", paymentReference: tag } })).id;
  orderId = (await createManualOrder(prisma, { clientId, recipientName: "Ana", recipientPhone: "55 1234 5678", addressLine: "x" })).id;
});
afterAll(async () => {
  await prisma.orderEvent.deleteMany({ where: { orderId } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.setting.deleteMany({ where: { key: { contains: orderId } } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("autoservicio del comprador", () => {
  it("verifica con los últimos 4 dígitos y limita intentos", async () => {
    expect((await buyerVerify(prisma, orderId, "0000", `ip-${tag}`)).ok).toBe(false);
    expect((await buyerVerify(prisma, orderId, "5678", `ip-${tag}`)).ok).toBe(true);
    for (let i = 0; i < 6; i++) await buyerVerify(prisma, orderId, "0000", `ip-${tag}`);
    expect((await buyerVerify(prisma, orderId, "5678", `ip-${tag}`)).error).toMatch(/Demasiados/);
  });

  it("solo deja elegir días hábiles próximos y guarda fecha e indicaciones", async () => {
    const days = buyerDates(new Date("2026-11-07T18:00:00Z")); // sábado
    expect(days[0].ymd).toBe("2026-11-09"); // salta el domingo
    const d = buyerDates()[1];
    await expect(buyerReschedule(prisma, orderId, "2020-01-01")).rejects.toThrow(/fechas disponibles/);
    await buyerReschedule(prisma, orderId, d.ymd);
    await buyerNote(prisma, orderId, { text: "Dejar en recepción", receiver: "Luis" });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.requestedDeliveryAt?.toISOString().slice(0, 10)).toBe(d.ymd);
    expect(o.instructions).toContain("Recibe: Luis. Dejar en recepción");
  });
});
