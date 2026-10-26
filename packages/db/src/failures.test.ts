import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma, applyDriverEvent, assignOrders, createManualOrder, hashPassword, getMaxAttempts, mustReturn,
  sendToWarehouse, rescheduleOrder, packagesToReturn, receiveReturn, returnToSeller, driversWithoutLocation, setShift,
} from "./index.ts";

const tag = `fl${Date.now()}`;
let clientId: string;
let drv: { id: string; userId: string };

const order = () => createManualOrder(prisma, { clientId, recipientName: "X", addressLine: "Calle 1" });
const ev = (orderId: string, type: "loaded" | "failed", reason?: "nadie" | "rechazo") =>
  applyDriverEvent(prisma, { driverId: drv.id, actorUserId: drv.userId, clientEventId: `${tag}-${Math.random()}`, orderId, type, occurredAt: new Date(), reason });
const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id }, include: { return: true } }));
const fail = async (id: string, reason: "nadie" | "rechazo" = "nadie") => {
  await assignOrders(prisma, [id], drv.id);
  await ev(id, "loaded");
  return ev(id, "failed", reason);
};

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Fallidos", paymentReference: tag, tariffAmount: 0 } })).id;
  const u = await prisma.user.create({
    data: { username: tag, name: "Rep Fallidos", role: "REPARTIDOR", passwordHash: await hashPassword("x12345678"), driver: { create: {} } },
    include: { driver: true },
  });
  drv = { id: u.driver!.id, userId: u.id };
});

afterAll(async () => {
  const ids = (await prisma.order.findMany({ where: { clientId }, select: { id: true } })).map((o) => o.id);
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.auditLog.deleteMany({ where: { entityId: drv.id } });
  await prisma.driver.delete({ where: { id: drv.id } });
  await prisma.user.delete({ where: { id: drv.userId } });
  await prisma.$disconnect();
});

describe("regla de regreso a bodega", () => {
  it("rechazo regresa siempre; si no, al agotar intentos", () => {
    expect(mustReturn("rechazo", 1, 2)).toBe(true);
    expect(mustReturn("nadie", 1, 2)).toBe(false);
    expect(mustReturn("nadie", 2, 2)).toBe(true);
  });
});

describe("fallidos y bodega", () => {
  it("primer intento fallido queda para reintentar; al agotar intentos pasa a 'llevar a bodega'", async () => {
    const max = await getMaxAttempts(prisma);
    const o = await order();
    for (let i = 1; i < max; i++) {
      expect(await fail(o.id)).toMatchObject({ ok: true, status: "FAILED" });
    }
    expect(await fail(o.id)).toMatchObject({ ok: true, status: "RETURNING" });
    const after = await status(o.id);
    expect(after.status).toBe("RETURNING");
    expect(after.driverId).toBe(drv.id); // lo sigue trayendo él
    expect(after.return?.status).toBe("PENDING_RECEIPT");
    expect((await packagesToReturn(prisma, drv.id)).map((p) => p.id)).toContain(o.id);

    // Llega a bodega: ya no lo trae el repartidor
    expect(await receiveReturn(prisma, o.code)).toMatchObject({ status: "ok" });
    const inWh = await status(o.id);
    expect(inWh).toMatchObject({ status: "RETURNED_TO_WAREHOUSE", driverId: null });
    expect((await packagesToReturn(prisma, drv.id)).map((p) => p.id)).not.toContain(o.id);
  });

  it("rechazo va directo a bodega", async () => {
    const o = await order();
    expect(await fail(o.id, "rechazo")).toMatchObject({ status: "RETURNING" });
  });

  it("despacho manda a bodega o reprograma; desde bodega se puede reintentar", async () => {
    const o = await order();
    await fail(o.id);
    expect(await sendToWarehouse(prisma, o.id)).toEqual({ ok: true });
    expect((await status(o.id)).status).toBe("RETURNING");
    await receiveReturn(prisma, o.code);

    const date = new Date("2030-01-15T12:00:00-06:00");
    expect(await rescheduleOrder(prisma, o.id, { date })).toEqual({ ok: true });
    const r = await status(o.id);
    expect(r).toMatchObject({ status: "RESCHEDULED", driverId: null, return: null });
    expect(r.requestedDeliveryAt?.toISOString()).toBe(date.toISOString());
    // Reprogramado ya no se puede "devolver al vendedor" sin volver a recibirlo
    expect((await returnToSeller(prisma, o.code)).status).toBe("error");
    // Y se puede volver a asignar
    expect(await assignOrders(prisma, [o.id], drv.id)).toBe(1);
  });

  it("no permite acciones inválidas", async () => {
    const o = await order();
    expect(await rescheduleOrder(prisma, o.id)).toMatchObject({ ok: false });
    await prisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
    expect(await sendToWarehouse(prisma, o.id)).toMatchObject({ ok: false });
  });
});

describe("repartidores sin ubicación", () => {
  it("avisa del que lleva más de 10 min sin reportar, no del que acaba de iniciar", async () => {
    await setShift(prisma, drv.id, true);
    const now = new Date();
    expect((await driversWithoutLocation(prisma, 10, now)).map((d) => d.id)).not.toContain(drv.id);
    await prisma.driver.update({ where: { id: drv.id }, data: { lastLocationAt: new Date(now.getTime() - 25 * 60_000) } });
    expect((await driversWithoutLocation(prisma, 10, now)).map((d) => d.id)).toContain(drv.id);
    await prisma.driver.update({ where: { id: drv.id }, data: { lastLocationAt: now } });
    expect((await driversWithoutLocation(prisma, 10, now)).map((d) => d.id)).not.toContain(drv.id);
    await setShift(prisma, drv.id, false);
  });
});
