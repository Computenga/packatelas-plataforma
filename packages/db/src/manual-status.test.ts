import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, adminMarkOrder, adminMarkPickup, cancelPickup, createManualOrder, requestPickup } from "./index.ts";

const tag = `ms${Date.now()}`;
let clientId: string, branchId: string, userId: string;
beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Manual", paymentReference: tag, tariffAmount: 0, pickupExemptUntil: new Date(Date.now() + 86400_000) } })).id;
  branchId = (await prisma.branch.create({ data: { clientId, name: "Matriz", address: "Calle 1" } })).id;
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.pickup.deleteMany({ where: { clientId } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("recolecciones: una por día y cierre a mano", () => {
  it("no duplica la recolección del mismo día; se puede cancelar y volver a pedir", async () => {
    const a = await requestPickup(prisma, { clientId, branchId, ymd: "2030-01-07" });
    const b = await requestPickup(prisma, { clientId, branchId, ymd: "2030-01-07", note: "Tocar timbre" });
    expect(a.existing).toBe(false);
    expect(b.existing).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await prisma.pickup.count({ where: { branchId } })).toBe(1);
    await expect(prisma.pickup.create({ data: { clientId, branchId, scheduledFor: new Date("2030-01-07T00:00:00Z") } })).rejects.toThrow();
    await cancelPickup(prisma, a.id, "repetida", userId);
    expect((await prisma.order.findFirstOrThrow({ where: { pickupId: a.id } })).status).toBe("CANCELLED");
    const c = await requestPickup(prisma, { clientId, branchId, ymd: "2030-01-07" });
    expect(c.existing).toBe(false);
    await expect(adminMarkPickup(prisma, c.id, { collected: true, note: "x" }, userId)).rejects.toThrow(/por qué/);
    await adminMarkPickup(prisma, c.id, { collected: true, count: 12, note: "El repartidor se quedó sin batería" }, userId);
    const p = await prisma.pickup.findUniqueOrThrow({ where: { id: c.id }, include: { order: true } });
    expect(p.status).toBe("COLLECTED");
    expect(p.order?.status).toBe("DELIVERED");
    await expect(cancelPickup(prisma, c.id, "x", userId)).rejects.toThrow(/recolectó/);
  });

  it("envío marcado a mano: entregado o no entregado", async () => {
    const o = await createManualOrder(prisma, { clientId, addressLine: "Av 1" });
    await adminMarkOrder(prisma, o.id, { outcome: "failed", reason: "ausente", note: "Nadie abrió" }, userId);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("FAILED");
    await adminMarkOrder(prisma, o.id, { outcome: "delivered", receiverName: "Ana", note: "Confirmó por WhatsApp" }, userId);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DELIVERED");
    await expect(adminMarkOrder(prisma, o.id, { outcome: "failed", note: "otra vez" }, userId)).rejects.toThrow(/cerrado/);
  });
});
