import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, assignOrders, unassignOrders, applyDriverEvent, recordLocations, createManualOrder, hashPassword } from "./index.ts";

const tag = `d${Date.now()}`;
let clientId: string;
let driverA: { id: string; userId: string };
let driverB: { id: string; userId: string };

async function newDriver(n: string) {
  const u = await prisma.user.create({
    data: { username: `${tag}${n}`, name: `Rep ${n}`, role: "REPARTIDOR", passwordHash: await hashPassword("x12345678"), driver: { create: {} } },
    include: { driver: true },
  });
  return { id: u.driver!.id, userId: u.id };
}
const order = () => createManualOrder(prisma, { clientId, recipientName: "X", addressLine: "Calle 1" });
const ev = (driver: { id: string; userId: string }, orderId: string, type: "loaded" | "delivered" | "failed", extra = {}) =>
  applyDriverEvent(prisma, {
    driverId: driver.id,
    actorUserId: driver.userId,
    clientEventId: `${tag}-${Math.random()}`,
    orderId,
    type,
    occurredAt: new Date(),
    ...extra,
  });

beforeAll(async () => {
  const c = await prisma.client.create({ data: { publicId: tag, name: "Desp", paymentReference: tag, tariffAmount: 0 } });
  clientId = c.id;
  driverA = await newDriver("a");
  driverB = await newDriver("b");
});

afterAll(async () => {
  const ids = (await prisma.order.findMany({ where: { clientId }, select: { id: true } })).map((o) => o.id);
  await prisma.evidence.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  for (const d of [driverA, driverB]) {
    await prisma.locationPing.deleteMany({ where: { driverId: d.id } });
    await prisma.driver.delete({ where: { id: d.id } });
    await prisma.user.delete({ where: { id: d.userId } });
  }
  await prisma.$disconnect();
});

describe("despacho", () => {
  it("asigna, reasigna y desasigna", async () => {
    const o = await order();
    expect(await assignOrders(prisma, [o.id], driverA.id)).toBe(1);
    expect(await assignOrders(prisma, [o.id], driverA.id)).toBe(0); // ya era suyo
    expect(await assignOrders(prisma, [o.id], driverB.id)).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).driverId).toBe(driverB.id);
    expect(await unassignOrders(prisma, [o.id])).toBe(1);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.driverId).toBeNull();
    expect(after.status).toBe("CREATED");
  });

  it("carga → entrega con foto; sin foto se rechaza", async () => {
    const o = await order();
    await assignOrders(prisma, [o.id], driverA.id);
    expect(await ev(driverA, o.id, "loaded")).toMatchObject({ ok: true, status: "OUT_FOR_DELIVERY" });
    expect(await ev(driverA, o.id, "delivered")).toMatchObject({ ok: false });
    expect(await ev(driverA, o.id, "delivered", { photoKey: "x.jpg", receiverName: "Ana" })).toMatchObject({ ok: true, status: "DELIVERED" });
    const done = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { evidence: true } });
    expect(done.deliveredAt).not.toBeNull();
    expect(done.evidence[0].receiverName).toBe("Ana");
  });

  it("otro repartidor no puede cerrar ni cargar un pedido ajeno", async () => {
    const o = await order();
    await assignOrders(prisma, [o.id], driverA.id);
    expect(await ev(driverB, o.id, "loaded")).toMatchObject({ ok: false });
    expect(await ev(driverB, o.id, "failed", { reason: "nadie" })).toMatchObject({ ok: false });
  });

  it("escanear al cargar un pedido libre se lo asigna al repartidor", async () => {
    const o = await order();
    expect(await ev(driverB, o.id, "loaded")).toMatchObject({ ok: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).driverId).toBe(driverB.id);
  });

  it("fallido suma intento y guarda motivo; reintentos de la cola no duplican", async () => {
    const o = await order();
    await assignOrders(prisma, [o.id], driverA.id);
    const input = {
      driverId: driverA.id,
      actorUserId: driverA.userId,
      clientEventId: `${tag}-fijo`,
      orderId: o.id,
      type: "failed" as const,
      reason: "nadie" as const,
      occurredAt: new Date(Date.now() - 3600_000),
    };
    const results = await Promise.all([applyDriverEvent(prisma, input), applyDriverEvent(prisma, input), applyDriverEvent(prisma, input)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const f = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { events: { where: { type: "failed" } } } });
    expect(f.status).toBe("FAILED");
    expect(f.attempts).toBe(1);
    expect(f.events).toHaveLength(1);
    expect(f.events[0].note).toContain("No había nadie");
    // Se registra la hora real del teléfono (hace una hora), no la de llegada.
    expect(Date.now() - f.events[0].occurredAt.getTime()).toBeGreaterThan(3500_000);
  });

  it("registra ubicaciones y actualiza la última", async () => {
    const n = await recordLocations(prisma, driverA.id, [
      { lat: 19.4, lng: -99.1, at: new Date(Date.now() - 60_000) },
      { lat: 19.41, lng: -99.11, at: new Date() },
      { lat: 999, lng: 0, at: new Date() },
    ]);
    expect(n).toBe(2);
    const d = await prisma.driver.findUniqueOrThrow({ where: { id: driverA.id } });
    expect(d.lastLat).toBe(19.41);
  });
});
