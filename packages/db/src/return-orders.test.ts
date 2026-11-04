import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDriverEvent, assignOrders, cancelReturnOrder, createManualOrder, createReturnOrder, hashPassword, markReturning, prisma, receiveReturn, returnCandidate, returnToSeller, searchReturnCandidates } from "./index.ts";

const tag = `dv${Date.now()}`;
let clientId: string, otherClient: string, branchId: string, staff: string;
let driver: { id: string; userId: string };

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Tienda DV", paymentReference: tag, tariffAmount: 60, chargingEnabled: true, phone: "5512345678" } })).id;
  otherClient = (await prisma.client.create({ data: { publicId: `${tag}o`, name: "Otra", paymentReference: `${tag}o`, phone: "5512345679" } })).id;
  branchId = (await prisma.branch.create({ data: { clientId, name: "Centro", address: "Calle A 1", lat: 19.41, lng: -99.15, phone: "5511112222" } })).id;
  const u = await prisma.user.create({ data: { username: `${tag}r`, name: "Rep DV", role: "REPARTIDOR", passwordHash: await hashPassword("x12345678"), driver: { create: { lastLat: 19.4, lastLng: -99.14 } } }, include: { driver: true } });
  driver = { id: u.driver!.id, userId: u.id };
  staff = (await prisma.user.create({ data: { username: `${tag}s`, name: "Desp", role: "DESPACHADOR", passwordHash: "x" } })).id;
});
afterAll(async () => {
  const ids = (await prisma.order.findMany({ where: { clientId: { in: [clientId, otherClient] } }, select: { id: true } })).map((o) => o.id);
  await prisma.order.updateMany({ where: { id: { in: ids } }, data: { returnOrderId: null } });
  await prisma.driverCustody.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.evidence.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.returnCustody.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { clientId: { in: [clientId, otherClient] } } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId: { in: [clientId, otherClient] } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [staff, driver.userId] } } });
  await prisma.client.deleteMany({ where: { id: { in: [clientId, otherClient] } } });
  await prisma.driver.delete({ where: { id: driver.id } });
  await prisma.user.deleteMany({ where: { id: { in: [driver.userId, staff] } } });
  await prisma.$disconnect();
});

describe("órdenes de devolución", () => {
  it("crea DV con paquetes de una tienda, se asigna, al entregarla quedan devueltos y no se cobra", async () => {
    const a = await createManualOrder(prisma, { clientId, recipientName: "A", addressLine: "x" });
    const b = await createManualOrder(prisma, { clientId, recipientName: "B", addressLine: "x" });
    const other = await createManualOrder(prisma, { clientId: otherClient, recipientName: "C", addressLine: "x" });
    expect((await returnCandidate(prisma, { raw: a.code })).ok).toBe(false); // aún en entrega
    await prisma.$transaction((tx) => markReturning(tx, a.id, "prueba", "ADMIN", staff));
    await prisma.$transaction((tx) => markReturning(tx, b.id, "prueba", "ADMIN", staff));
    await receiveReturn(prisma, b.code, staff, "ADMIN");
    await prisma.$transaction((tx) => markReturning(tx, other.id, "prueba", "ADMIN", staff));
    expect((await returnCandidate(prisma, { raw: a.code })).ok).toBe(true);
    expect((await searchReturnCandidates(prisma, "", clientId)).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    await expect(createReturnOrder(prisma, { orderIds: [a.id, other.id] }, staff)).rejects.toThrow(/misma tienda/);
    const chargesBefore = await prisma.ledgerEntry.count({ where: { clientId } });

    const dv = await createReturnOrder(prisma, { orderIds: [a.id, b.id] }, staff);
    expect(dv.code).toMatch(/^DV-\d{5,}$/);
    expect(dv.kind).toBe("RETURN");
    expect(dv.branchId).toBe(branchId);
    expect((await prisma.returnCustody.findUnique({ where: { orderId: a.id } }))?.status).toBe("IN_WAREHOUSE");
    const again = await returnCandidate(prisma, { orderId: a.id });
    expect(again.ok === false && again.error).toContain(dv.code);
    // se escanea por su folio
    expect((await returnCandidate(prisma, { raw: dv.code })).ok).toBe(false);

    expect(await assignOrders(prisma, [dv.id], driver.id, staff)).toBe(1);
    expect((await applyDriverEvent(prisma, { driverId: driver.id, actorUserId: driver.userId, clientEventId: `${tag}-1`, orderId: dv.id, type: "loaded", occurredAt: new Date() })).ok).toBe(true);
    const r = await applyDriverEvent(prisma, { driverId: driver.id, actorUserId: driver.userId, clientEventId: `${tag}-2`, orderId: dv.id, type: "delivered", occurredAt: new Date(), photoKey: "evidence/2026/11/00000000-0000-0000-0000-000000000000.jpg", receiverName: "Encargada" });
    expect(r).toMatchObject({ ok: true, status: "DELIVERED" });
    for (const id of [a.id, b.id]) {
      const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { return: true } });
      expect([o.status, o.return?.status]).toEqual(["RETURNED_TO_SELLER", "RETURNED_TO_SELLER"]);
    }
    expect(await prisma.ledgerEntry.count({ where: { clientId } })).toBe(chargesBefore);
  });

  it("cancelar una DV libera sus paquetes", async () => {
    const c = await createManualOrder(prisma, { clientId, recipientName: "C", addressLine: "x" });
    await prisma.$transaction((tx) => markReturning(tx, c.id, "prueba", "ADMIN", staff));
    const dv = await createReturnOrder(prisma, { orderIds: [c.id] }, staff);
    await cancelReturnOrder(prisma, dv.id, "se reprograma", staff);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: c.id } })).returnOrderId).toBeNull();
    expect((await returnCandidate(prisma, { orderId: c.id })).ok).toBe(true);
  });

  it("un paquete marcado «devuelto al vendedor» con el escáner (sin DV) se puede meter a una DV", async () => {
    const d = await createManualOrder(prisma, { clientId, recipientName: "D", addressLine: "x" });
    await prisma.$transaction((tx) => markReturning(tx, d.id, "prueba", "ADMIN", staff));
    await receiveReturn(prisma, d.code, staff, "ADMIN");
    expect((await returnToSeller(prisma, d.code, staff)).status).toBe("ok");
    const c = await returnCandidate(prisma, { raw: d.code });
    expect(c.ok && c.item.reopened).toBe(true);
    expect((await searchReturnCandidates(prisma, d.code, clientId)).map((x) => x.id)).toContain(d.id);
    const dv = await createReturnOrder(prisma, { orderIds: [d.id] }, staff);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: d.id }, include: { return: true } });
    expect([o.returnOrderId, o.return?.status, o.return?.returnedAt]).toEqual([dv.id, "IN_WAREHOUSE", null]);
    expect(o.status).not.toBe("RETURNED_TO_SELLER");
  });
});
