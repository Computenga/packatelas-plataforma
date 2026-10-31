import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma, assignOrders, unassignOrders, applyDriverEvent, createManualOrder, hashPassword, receiveReturn, reconcileCustody,
  requestPickup, assignPickup, startPickupRoute, completePickup, startNextPickup, applyFlexAssignment,
} from "./index.ts";

const tag = `cu${Date.now()}`;
const seller = 7_000_000_000 + Math.floor(Math.random() * 1_000_000);
let clientId: string;
let branchA: string;
let branchB: string;
let driverA: { id: string; userId: string };
let driverB: { id: string; userId: string };
let staff: string;

async function newDriver(n: string) {
  const u = await prisma.user.create({
    data: { username: `${tag}${n}`, name: `Rep ${n}`, role: "REPARTIDOR", passwordHash: await hashPassword("x12345678"), driver: { create: { lastLat: 19.4, lastLng: -99.14 } } },
    include: { driver: true },
  });
  return { id: u.driver!.id, userId: u.id };
}
const order = () => createManualOrder(prisma, { clientId, recipientName: "X", addressLine: "Calle 1" });
const ev = (d: { id: string; userId: string }, orderId: string, type: "loaded" | "delivered" | "failed", extra = {}) =>
  applyDriverEvent(prisma, { driverId: d.id, actorUserId: d.userId, clientEventId: `${tag}-${Math.random()}`, orderId, type, occurredAt: new Date(), ...extra });
const open = (orderId: string) => prisma.driverCustody.findFirst({ where: { orderId, endedAt: null } });
const url = (id: string) => `https://ejemplo.test/s/${id}`;

beforeAll(async () => {
  const c = await prisma.client.create({ data: { publicId: tag, name: "Inv", paymentReference: tag, tariffAmount: 0, phone: "5512345678" } });
  clientId = c.id;
  branchA = (await prisma.branch.create({ data: { clientId, name: "Centro", address: "Calle A 1", lat: 19.41, lng: -99.15, phone: "5511112222" } })).id;
  branchB = (await prisma.branch.create({ data: { clientId, name: "Norte", address: "Calle B 2", lat: 19.5, lng: -99.1, phone: "5533334444" } })).id;
  driverA = await newDriver("a");
  driverB = await newDriver("b");
  staff = (await prisma.user.create({ data: { username: `${tag}s`, name: "Desp", role: "DESPACHADOR", passwordHash: await hashPassword("x12345678") } })).id;
});

afterAll(async () => {
  const ids = (await prisma.order.findMany({ where: { clientId }, select: { id: true } })).map((o) => o.id);
  await prisma.notification.deleteMany({ where: { clientId } });
  await prisma.evidence.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.returnCustody.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.mlFlexShipment.deleteMany({ where: { clientId } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.pickup.deleteMany({ where: { clientId } });
  await prisma.mlJob.deleteMany({ where: { mlUserId: BigInt(seller) } });
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.flexIdentity.deleteMany({ where: { driverId: { in: [driverA.id, driverB.id] } } });
  for (const d of [driverA, driverB]) {
    await prisma.driver.delete({ where: { id: d.id } });
    await prisma.user.delete({ where: { id: d.userId } });
  }
  await prisma.user.delete({ where: { id: staff } });
  await prisma.$disconnect();
});

describe("inventario por repartidor", () => {
  it("entra al asignar, se traspasa al reasignar y sale si el despacho lo quita antes de cargar", async () => {
    const o = await order();
    await assignOrders(prisma, [o.id], driverA.id);
    expect((await open(o.id))?.driverId).toBe(driverA.id);
    await assignOrders(prisma, [o.id], driverB.id);
    expect((await open(o.id))?.driverId).toBe(driverB.id);
    expect(await prisma.driverCustody.count({ where: { orderId: o.id, endReason: "TRANSFERRED" } })).toBe(1);
    await unassignOrders(prisma, [o.id]);
    expect(await open(o.id)).toBeNull();
    const types = (await prisma.orderEvent.findMany({ where: { orderId: o.id }, select: { type: true } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["custody_in", "custody_transfer", "custody_out"]));
  });

  it("sale al entregar con foto (pedido propio)", async () => {
    const o = await order();
    await assignOrders(prisma, [o.id], driverA.id);
    await ev(driverA, o.id, "loaded");
    expect((await ev(driverA, o.id, "delivered", { photoKey: "evidence/x.jpg" })).ok).toBe(true);
    expect(await open(o.id)).toBeNull();
    expect((await prisma.driverCustody.findFirstOrThrow({ where: { orderId: o.id } })).endReason).toBe("DELIVERED");
  });

  it("si es de ML, también tiene que estar entregado en ML", async () => {
    const o = await order();
    await prisma.order.update({ where: { id: o.id }, data: { mlShipmentId: BigInt(seller) * 10n + 1n, mlStatus: "shipped" } });
    await assignOrders(prisma, [o.id], driverA.id);
    await ev(driverA, o.id, "loaded");
    await ev(driverA, o.id, "delivered", { photoKey: "evidence/y.jpg" });
    expect(await open(o.id)).not.toBeNull();
    await prisma.order.update({ where: { id: o.id }, data: { mlStatus: "delivered" } });
    expect(await reconcileCustody(prisma, o.id)).toBe(true);
    expect(await open(o.id)).toBeNull();
  });

  it("solo admin o despachador lo reciben de vuelta en Devoluciones", async () => {
    const o = await order();
    await assignOrders(prisma, [o.id], driverA.id);
    await ev(driverA, o.id, "loaded");
    await ev(driverA, o.id, "failed", { reason: "nadie" });
    const r1 = await receiveReturn(prisma, o.code, staff, "OPERADOR");
    expect(r1.status).toBe("error");
    expect(await open(o.id)).not.toBeNull();
    const r2 = await receiveReturn(prisma, o.code, staff, "DESPACHADOR");
    expect(r2.status).toBe("ok");
    expect(await open(o.id)).toBeNull();
    expect((await prisma.driverCustody.findFirstOrThrow({ where: { orderId: o.id, endReason: { not: null } } })).endReason).toBe("RETURNED");
  });
});

describe("recolecciones como pedido", () => {
  it("crea el pedido, avisa al asignar, manda el enlace al ir en camino y exige foto", async () => {
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    const p1 = await requestPickup(prisma, { clientId, branchId: branchA, ymd, expectedCount: 5 });
    const p2 = await requestPickup(prisma, { clientId, branchId: branchB, ymd });
    const o1 = await prisma.order.findUniqueOrThrow({ where: { pickupId: p1.id } });
    expect(o1.kind).toBe("PICKUP");
    expect(o1.code).toMatch(/^RC-\d{6}$/);
    expect(o1.addressLine).toBe("Calle A 1");

    await assignPickup(prisma, p1.id, driverA.id);
    await assignPickup(prisma, p2.id, driverA.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o1.id } })).status).toBe("ASSIGNED");
    const asg = await prisma.notification.findMany({ where: { clientId, event: "recoleccion_asignada" } });
    expect(asg.map((n) => n.to).sort()).toEqual(["525511112222", "525533334444"]);
    expect(await prisma.notification.count({ where: { clientId, event: "recoleccion_en_camino" } })).toBe(0);

    expect(await startPickupRoute(prisma, p1.id, driverA.id, { trackingUrl: url })).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o1.id } })).status).toBe("OUT_FOR_DELIVERY");
    const enCamino = await prisma.notification.findFirstOrThrow({ where: { clientId, event: "recoleccion_en_camino" } });
    expect(enCamino.to).toBe("525511112222");
    expect(enCamino.params).toContain(url(o1.id));

    await expect(completePickup(prisma, { pickupId: p1.id, driverId: driverA.id, collected: true, count: 4 })).rejects.toThrow(/foto/);
    await completePickup(prisma, { pickupId: p1.id, driverId: driverA.id, collected: true, count: 4, photoKeys: ["evidence/r1.jpg", "evidence/r2.jpg"] });
    const done = await prisma.order.findUniqueOrThrow({ where: { id: o1.id }, include: { evidence: true } });
    expect(done.status).toBe("DELIVERED");
    expect(done.evidence).toHaveLength(2);
    // Inventario: las recolecciones no entran.
    expect(await prisma.driverCustody.count({ where: { orderId: o1.id } })).toBe(0);

    // La siguiente de su lista pasa sola a "en camino" y recibe su enlace.
    expect(await startNextPickup(prisma, driverA.id, { trackingUrl: url })).toBe(p2.id);
    const n2 = await prisma.notification.findMany({ where: { clientId, event: "recoleccion_en_camino" } });
    expect(n2.map((n) => n.to).sort()).toEqual(["525511112222", "525533334444"]);
  });
});

describe("Flex: recuperado tomado por uno de los nuestros", () => {
  it("se registra como pedido, se le asigna y entra a su inventario", async () => {
    const acc = await prisma.mlAccount.create({ data: { mlUserId: BigInt(seller), nickname: `V${tag}`, clientId } });
    const sid = BigInt(seller) * 10n + 7n;
    await prisma.mlFlexShipment.create({ data: { shipmentId: sid, mlAccountId: acc.id, clientId, logisticType: "self_service", mlStatus: "ready_to_ship", addressLine: "Av Flex 9", recipientName: "Comprador" } });
    const flexId = BigInt(900_000_000 + Math.floor(Math.random() * 1000));
    await prisma.flexIdentity.create({ data: { flexDriverId: flexId, driverId: driverB.id } });

    const r = await applyFlexAssignment(prisma, sid, flexId.toString());
    expect(r.status).toBe("assigned");
    const o = await prisma.order.findUniqueOrThrow({ where: { mlShipmentId: sid } });
    expect(o.driverId).toBe(driverB.id);
    expect(o.status).toBe("ASSIGNED");
    expect(o.addressLine).toBe("Av Flex 9");
    expect((await prisma.mlFlexShipment.findUniqueOrThrow({ where: { shipmentId: sid } })).orderId).toBe(o.id);
    expect((await open(o.id))?.driverId).toBe(driverB.id);

    // Un driver Flex que no es nuestro no convierte recuperados.
    const sid2 = sid + 1n;
    await prisma.mlFlexShipment.create({ data: { shipmentId: sid2, mlAccountId: acc.id, clientId, logisticType: "self_service", mlStatus: "ready_to_ship" } });
    expect((await applyFlexAssignment(prisma, sid2, "123456789")).status).toBe("unlinked");
    expect(await prisma.order.findUnique({ where: { mlShipmentId: sid2 } })).toBeNull();
  });
});
