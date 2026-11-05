import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDriverEvent, assignOrders, createManualOrder, driverByVehicle, gateCheckPackage, gateExpected, gateRoster, prisma, saveArrival, saveDeparture } from "./index.ts";

const tag = `gt${Date.now()}`;
let clientId: string, staff: string, vehicleId: string, empId: string, empBajaId: string;
let d1: { id: string; userId: string }, d2: { id: string; userId: string };
const orders: { id: string; code: string }[] = [];

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Tienda GT", paymentReference: tag } })).id;
  staff = (await prisma.user.create({ data: { username: `${tag}s`, name: "Vigilante", role: "RECEPCION", passwordHash: "x" } })).id;
  const mk = async (n: string) => {
    const u = await prisma.user.create({ data: { username: `${tag}${n}`, name: `Rep ${n}`, role: "REPARTIDOR", passwordHash: "x", driver: { create: {} } }, include: { driver: true } });
    return { id: u.driver!.id, userId: u.id };
  };
  d1 = await mk("a"); d2 = await mk("b");
  const no = 900000 + Math.floor(Math.random() * 90000);
  empId = (await prisma.employee.create({ data: { employeeNo: no, name: "Rep a", userId: d1.userId } })).id;
  empBajaId = (await prisma.employee.create({ data: { employeeNo: no + 1, name: "Rep b", userId: d2.userId, status: "BAJA", endDate: new Date() } })).id;
  vehicleId = (await prisma.vehicle.create({ data: { code: `M-${tag.slice(-5).toUpperCase()}` } })).id;
  await prisma.vehicleCheck.create({ data: { kind: "MATUTINO", vehicleId, employeeId: empId, photos: [] } });
  for (let i = 0; i < 4; i++) orders.push(await createManualOrder(prisma, { clientId, recipientName: `R${i}`, addressLine: "x" }));
  await assignOrders(prisma, orders.slice(0, 3).map((o) => o.id), d1.id, staff);
  for (const o of orders.slice(0, 3)) await applyDriverEvent(prisma, { driverId: d1.id, actorUserId: d1.userId, clientEventId: `${tag}-${o.id}`, orderId: o.id, type: "loaded", occurredAt: new Date() });
});
afterAll(async () => {
  const ids = orders.map((o) => o.id);
  await prisma.gateCheck.deleteMany({ where: { driverId: { in: [d1.id, d2.id] } } });
  await prisma.driverCustody.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { clientId } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.vehicleCheck.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.delete({ where: { id: vehicleId } });
  await prisma.employee.deleteMany({ where: { id: { in: [empId, empBajaId] } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [staff, d1.userId, d2.userId] } } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.driver.deleteMany({ where: { id: { in: [d1.id, d2.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [staff, d1.userId, d2.userId] } } });
  await prisma.$disconnect();
});

describe("recepción", () => {
  it("el llavero identifica a quien hizo el último check matutino; las bajas salen sin acceso", async () => {
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(await driverByVehicle(prisma, v.code)).toMatchObject({ ok: true, driverId: d1.id });
    expect((await driverByVehicle(prisma, "M-NOEXISTE")).ok).toBe(false);
    const roster = await gateRoster(prisma);
    expect(roster.find((r) => r.driverId === d1.id)).toMatchObject({ active: true, expected: 3 });
    expect(roster.find((r) => r.driverId === d2.id)).toMatchObject({ active: false });
  });

  it("llegada: cuadra si escanea justo lo suyo; un paquete ajeno o faltante no cuadra", async () => {
    expect((await gateExpected(prisma, d1.id)).length).toBe(3);
    expect((await gateCheckPackage(prisma, d1.id, orders[3].code, "LLEGADA")).assigned).toBe(false);
    const good = await saveArrival(prisma, { driverId: d1.id, raws: [orders[0].code, orders[1].code, orders[2].code, orders[0].code], signatureKey: "gate/x.png", identifiedBy: "lista", guardId: staff });
    expect(good).toMatchObject({ ok: true, scanned: 3 });
    const bad = await saveArrival(prisma, { driverId: d1.id, raws: [orders[0].code, orders[3].code, "BASURA-123"], signatureKey: "gate/x.png", identifiedBy: "lista", guardId: staff });
    expect(bad.ok).toBe(false);
    expect(bad.extra.map((e) => e.code).sort()).toEqual([orders[3].code, "BASURA-123"].sort());
    expect(bad.missing.map((m) => m.code).sort()).toEqual([orders[1].code, orders[2].code].sort());
  });

  it("salida: paquete al azar suyo → ok; ajeno → auditoría con faltantes", async () => {
    expect(await saveDeparture(prisma, { driverId: d1.id, random: orders[1].code, identifiedBy: "lista", guardId: staff })).toMatchObject({ ok: true, audited: false });
    const a = await saveDeparture(prisma, { driverId: d1.id, random: orders[3].code, audit: [orders[0].code, orders[1].code], identifiedBy: "lista", guardId: staff });
    expect(a).toMatchObject({ ok: false, audited: true });
    expect(a.missing.map((m) => m.code)).toEqual([orders[2].code]);
    expect(a.extra.map((e) => e.code)).toEqual([orders[3].code]);
  });
});
