// Datos ficticios para las capturas del manual de uso (/ayuda). Solo en una base local aparte.
// Uso: DATABASE_URL=…/packatelas_manual pnpm --filter @packatelas/db exec tsx src/seed-manual.ts
import "dotenv/config";
import { prisma } from "./index.ts";
import { hashPassword } from "./password.ts";
import { createManualOrder } from "./orders.ts";
import { assignOrders, applyDriverEvent, setShift } from "./dispatch.ts";
import { markReturning } from "./failures.ts";
import { receiveReturn, createReturnOrder } from "./returns.ts";
import { requestPickup, todayMx } from "./pickups.ts";
import { registerManualPayment } from "./payments.ts";
import { chargeOrder } from "./ledger.ts";
import { createTask } from "./tasks.ts";

async function main() {
  if (process.env.NODE_ENV === "production" || !/packatelas_manual/.test(process.env.DATABASE_URL ?? "")) throw new Error("Solo en la base local packatelas_manual");
  const pw = await hashPassword("packatelas");
  const client = await prisma.client.update({
    where: { publicId: "cmx00001" },
    data: { name: "Electrónica La Esquina", contactName: "Laura Méndez", phone: "5500000001", chargingEnabled: true, tariffAmount: 85 },
    include: { branches: true },
  });
  const branch = client.branches[0];
  await prisma.branch.update({ where: { id: branch.id }, data: { name: "Matriz Obrera", phone: "5500000001" } });
  await prisma.user.updateMany({ data: { mustChangePassword: false, lastLoginAt: new Date(), tourSeenAt: new Date() } });
  await prisma.user.update({ where: { username: "cliente" }, data: { name: "Laura Méndez" } });
  await prisma.user.update({ where: { username: "repartidor" }, data: { name: "Juan Pérez" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const drv = await prisma.driver.findFirstOrThrow({ where: { user: { username: "repartidor" } }, include: { user: true } });
  await prisma.driver.update({ where: { id: drv.id }, data: { lastLat: 19.4142, lastLng: -99.1405, lastLocationAt: new Date() } });
  await setShift(prisma, drv.id, true, admin.id);
  for (const [u, n] of [["rep2", "Pedro Ramírez"], ["rep3", "María López"]] as const) {
    const usr = await prisma.user.upsert({ where: { username: u }, update: {}, create: { username: u, name: n, role: "REPARTIDOR", passwordHash: pw, lastLoginAt: new Date() } });
    await prisma.driver.upsert({ where: { userId: usr.id }, update: {}, create: { userId: usr.id, vehicleType: "moto", lastLat: 19.43, lastLng: -99.15, lastLocationAt: new Date() } });
  }
  const other = await prisma.client.upsert({
    where: { publicId: "cmx00002" }, update: {},
    create: { publicId: "cmx00002", name: "Moda Roma Boutique", contactName: "Sofía", phone: "5500000002", paymentReference: "PKT00002", tariffAmount: 80, branches: { create: { name: "Roma Norte", address: "Colima 120, Roma Nte., CDMX", lat: 19.419, lng: -99.16 } } },
  });

  const people = [
    ["Ana Torres", "Av. Insurgentes Sur 1602, Crédito Constructor", "Benito Juárez", 19.3676, -99.1797],
    ["Carlos Ruiz", "Calz. de Tlalpan 1500, Portales", "Benito Juárez", 19.3693, -99.1428],
    ["Diana Flores", "Av. Universidad 1000, Del Valle", "Benito Juárez", 19.3727, -99.1656],
    ["Eduardo Silva", "Dr. Vértiz 800, Narvarte", "Benito Juárez", 19.3906, -99.1497],
    ["Fernanda Gil", "Durango 200, Roma Nte.", "Cuauhtémoc", 19.4199, -99.1609],
    ["Gabriel Núñez", "Av. Revolución 500, San Pedro de los Pinos", "Benito Juárez", 19.3884, -99.1857],
    ["Héctor Vega", "Eje Central 300, Doctores", "Cuauhtémoc", 19.4207, -99.1428],
    ["Irene Castro", "Av. Coyoacán 1200, Del Valle", "Benito Juárez", 19.3801, -99.1683],
    ["Jorge Ortiz", "Av. Cuauhtémoc 600, Narvarte", "Benito Juárez", 19.3995, -99.1555],
    ["Karla Ríos", "Tehuantepec 50, Roma Sur", "Cuauhtémoc", 19.4111, -99.1617],
  ] as const;
  const orders = [];
  for (const [i, [name, addr, city, lat, lng]] of people.entries()) {
    orders.push(await createManualOrder(prisma, {
      clientId: client.id, branchId: branch.id, recipientName: name, recipientPhone: `55000010${String(i).padStart(2, "0")}`,
      addressLine: addr, city, state: "CDMX", lat, lng, itemsSummary: ["1× Audífonos inalámbricos", "1× Cargador USB-C", "2× Cable HDMI", "1× Mouse"][i % 4],
      instructions: i === 1 ? "Dejar en recepción del edificio" : undefined, eventSource: "CLIENT",
    }, admin.id));
  }
  const ev = (n: number) => `manual-${Date.now()}-${n}`;
  // En ruta con el repartidor demo: 0..4
  await assignOrders(prisma, orders.slice(0, 6).map((o) => o.id), drv.id, admin.id);
  for (const o of orders.slice(0, 5)) await applyDriverEvent(prisma, { driverId: drv.id, actorUserId: drv.userId, clientEventId: ev(Math.random()), orderId: o.id, type: "loaded", occurredAt: new Date() });
  // Entregado: 5
  await applyDriverEvent(prisma, { driverId: drv.id, actorUserId: drv.userId, clientEventId: ev(5), orderId: orders[5].id, type: "loaded", occurredAt: new Date() });
  await applyDriverEvent(prisma, { driverId: drv.id, actorUserId: drv.userId, clientEventId: ev(55), orderId: orders[5].id, type: "delivered", occurredAt: new Date(), receiverName: "Gabriel Núñez", lat: 19.3884, lng: -99.1857 });
  await chargeOrder(prisma, orders[5].id, admin.id).catch(() => null);
  // No entregado → regresa a bodega: 6 y 7
  for (const o of [orders[6], orders[7]]) await prisma.$transaction((tx) => markReturning(tx, o.id, "No había nadie (2 intentos)", "ADMIN", admin.id));
  await receiveReturn(prisma, orders[6].code, admin.id, "ADMIN");
  await createReturnOrder(prisma, { orderIds: [orders[6].id] }, admin.id);
  // 8 y 9 quedan recién creados (por recolectar)
  await requestPickup(prisma, { clientId: client.id, branchId: branch.id, ymd: todayMx(), expectedCount: 5, note: "Paquetes en mostrador" }, admin.id).catch((e) => console.log("pickup:", e.message));
  await createManualOrder(prisma, { clientId: other.id, recipientName: "Luis Mora", addressLine: "Álvaro Obregón 100, Roma Nte.", city: "Cuauhtémoc", lat: 19.417, lng: -99.16 }, admin.id);
  await registerManualPayment(prisma, { clientId: client.id, amount: 500, receivedAt: new Date(), method: "TRANSFER", reference: "SPEI 0001", note: "Abono semanal" }, admin.id).catch((e) => console.log("pago:", e.message));
  await createTask(prisma, admin.id, { title: "Revisar presión de llantas de la moto", description: "Antes de salir a ruta, revisa y anota la presión.", assigneeId: drv.userId, priority: "ALTA", dueAt: new Date(Date.now() + 26 * 3600_000), checklist: [{ text: "Llanta delantera" }, { text: "Llanta trasera" }] } as never).catch((e) => console.log("tarea:", e.message));
  await prisma.employee.create({ data: { employeeNo: 7, name: "Juan Pérez", rfc: "XAXX010101000", kind: "repartidor", position: "Repartidor", hireDate: new Date("2026-01-15"), userId: drv.userId, dailySalary: 400 } });
  await prisma.vehicle.create({ data: { code: "M-01", plate: "A1B2C3", brand: "Italika", model: "FT150", year: 2024, km: 12850 } }).catch((e) => console.log("moto:", e.message));
  for (const [i, [name, category, price]] of ([["Bolsa de envío 30×40 (50 pzas)", "Empaque", 189], ["Etiquetas térmicas 4×6 (500)", "Etiquetas", 249], ["Cinta canela 48 mm (6 pzas)", "Empaque", 159], ["Playo 18\" (1 rollo)", "Empaque", 139]] as const).entries()) {
    await prisma.storeProduct.create({ data: { wooId: 9000 + i, name, category, price, inStock: true } });
  }
  console.log("Datos del manual listos");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
