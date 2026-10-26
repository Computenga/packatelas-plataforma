import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma, createManualOrder, receiveReturn, returnToSeller, registerManualPayment, addAdjustment, setPickupExemption,
  generateAutoPickups, requestPickup, assignPickup, completePickup, getClientBalance, isoWeekday, hashPassword, applyUnidentifiedPayment,
} from "./index.ts";

const tag = `r${Date.now()}`;
let clientId: string;
let branchId: string;
let driver: { id: string; userId: string };

beforeAll(async () => {
  const c = await prisma.client.create({
    data: {
      publicId: tag, name: "Dev", paymentReference: tag, tariffAmount: 100,
      branches: { create: { name: "S", address: "A", autoPickup: true, autoPickupDays: [1, 3, 5] } },
    },
    include: { branches: true },
  });
  clientId = c.id;
  branchId = c.branches[0].id;
  const u = await prisma.user.create({
    data: { username: tag, name: "Rep", role: "REPARTIDOR", passwordHash: await hashPassword("x12345678"), driver: { create: {} } },
    include: { driver: true },
  });
  driver = { id: u.driver!.id, userId: u.id };
});

afterAll(async () => {
  const ids = (await prisma.order.findMany({ where: { clientId }, select: { id: true } })).map((o) => o.id);
  await prisma.returnCustody.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.payment.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.pickup.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.driver.delete({ where: { id: driver.id } });
  await prisma.user.delete({ where: { id: driver.userId } });
  await prisma.$disconnect();
});

describe("devoluciones", () => {
  it("dos escaneos en orden; repetir no duplica; no se salta el almacén", async () => {
    const o = await createManualOrder(prisma, { clientId, recipientName: "X", addressLine: "Y" });
    await prisma.order.update({ where: { id: o.id }, data: { status: "FAILED" } });
    expect((await returnToSeller(prisma, o.code)).status).toBe("error");
    expect((await receiveReturn(prisma, o.code)).status).toBe("ok");
    expect((await receiveReturn(prisma, o.code)).status).toBe("already");
    expect((await returnToSeller(prisma, o.code)).status).toBe("ok");
    expect((await returnToSeller(prisma, o.code)).status).toBe("already");
    const done = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { return: true } });
    expect(done.status).toBe("RETURNED_TO_SELLER");
    expect(done.return?.status).toBe("RETURNED_TO_SELLER");
  });

  it("un pedido entregado no entra a devoluciones", async () => {
    const o = await createManualOrder(prisma, { clientId, recipientName: "X", addressLine: "Y" });
    await prisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
    expect((await receiveReturn(prisma, o.code)).status).toBe("error");
  });
});

describe("cobros y recolecciones", () => {
  it("día ISO correcto", () => {
    expect(isoWeekday("2026-10-26")).toBe(1); // lunes
    expect(isoWeekday("2026-10-25")).toBe(7); // domingo
  });

  it("automáticas: solo en sus días, sin duplicar aunque corra en paralelo; bloqueada si debe", async () => {
    // El cliente debe $200 por los dos pedidos anteriores → bloqueada
    expect(await generateAutoPickups(prisma, "2026-11-01")).toBeGreaterThanOrEqual(0); // domingo: no aplica
    expect(await prisma.pickup.count({ where: { branchId } })).toBe(0);
    await Promise.all([generateAutoPickups(prisma, "2026-11-02"), generateAutoPickups(prisma, "2026-11-02"), generateAutoPickups(prisma, "2026-11-02")]);
    const list = await prisma.pickup.findMany({ where: { branchId } });
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("BLOCKED");
  });

  it("un abono que cubre el saldo desbloquea; la exención también", async () => {
    await registerManualPayment(prisma, { clientId, amount: 200, receivedAt: new Date(), method: "TRANSFER", reference: "SPEI-1" });
    expect((await getClientBalance(prisma, clientId)).toString()).toBe("0");
    expect((await prisma.pickup.findFirstOrThrow({ where: { branchId } })).status).toBe("SCHEDULED");

    await addAdjustment(prisma, clientId, 50, "Paquete extra grande");
    expect((await prisma.pickup.findFirstOrThrow({ where: { branchId } })).status).toBe("BLOCKED");
    await setPickupExemption(prisma, clientId, new Date(Date.now() + 86_400_000 * 30), "Acuerdo de pago");
    expect((await prisma.pickup.findFirstOrThrow({ where: { branchId } })).status).toBe("SCHEDULED");
  });

  it("asignar y confirmar con conteo; otro repartidor no puede cerrar", async () => {
    const p = await requestPickup(prisma, { clientId, branchId, ymd: "2026-11-03", expectedCount: 10 });
    expect(p.status).toBe("SCHEDULED");
    await assignPickup(prisma, p.id, driver.id);
    await expect(completePickup(prisma, { pickupId: p.id, driverId: "otro", collected: true, count: 8 })).rejects.toThrow();
    await expect(completePickup(prisma, { pickupId: p.id, driverId: driver.id, collected: true })).rejects.toThrow();
    await completePickup(prisma, { pickupId: p.id, driverId: driver.id, collected: true, count: 8 });
    const done = await prisma.pickup.findUniqueOrThrow({ where: { id: p.id } });
    expect(done.status).toBe("COLLECTED");
    expect(done.collectedCount).toBe(8);
  });

  it("abono con monto inválido se rechaza", async () => {
    await expect(registerManualPayment(prisma, { clientId, amount: -5, receivedAt: new Date(), method: "CASH" })).rejects.toThrow();
  });
});

describe("pagos sin identificar", () => {
  it("se aplican una sola vez aunque dos personas lo intenten a la vez", async () => {
    const p = await prisma.payment.create({
      data: { method: "TRANSFER", source: "GMAIL", status: "UNIDENTIFIED", amount: 75, receivedAt: new Date(), reference: "SIN-REF" },
    });
    const before = await getClientBalance(prisma, clientId);
    const r = await Promise.allSettled([applyUnidentifiedPayment(prisma, p.id, clientId), applyUnidentifiedPayment(prisma, p.id, clientId)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await getClientBalance(prisma, clientId)).toString()).toBe(before.minus(75).toString());
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("APPLIED");
  });
});
