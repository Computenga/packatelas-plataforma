import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { clientPushPrefs, hashPassword, prisma, processClientPush } from "./index.ts";

const tag = String(Date.now()).slice(-6);
let clientId = "";
let userId = "";
afterAll(async () => {
  await prisma.appNotice.deleteMany({ where: { userId } });
  await prisma.orderEvent.deleteMany({ where: { order: { clientId } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.user.deleteMany({ where: { clientId } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("avisos push a tiendas", () => {
  it("respeta lo que cada usuario eligió", async () => {
    expect(clientPushPrefs(null).entregado).toBe(true);
    expect(clientPushPrefs(null).recibido).toBe(false);
    expect(clientPushPrefs({ entregado: false }).entregado).toBe(false);

    await processClientPush(prisma); // fija el cursor en "ahora"
    const c = await prisma.client.create({ data: { publicId: `cmx8${tag}`, name: `Push ${tag}`, paymentReference: `PSH${tag}` } });
    clientId = c.id;
    userId = (await prisma.user.create({ data: { username: `cmx8${tag}`, name: c.name, role: "CLIENTE", clientId, passwordHash: await hashPassword("x"), notifyPrefs: { recibido: true } } })).id;
    const o = await prisma.order.create({ data: { code: `PSH-${tag}`, clientId, source: "MANUAL", addressLine: "x", recipientName: "Ana" } });
    await prisma.orderEvent.create({ data: { orderId: o.id, type: "created", source: "ADMIN", toStatus: "CREATED", occurredAt: new Date() } });
    await prisma.orderEvent.create({ data: { orderId: o.id, type: "scanned_loaded", source: "ADMIN", occurredAt: new Date() } });
    await prisma.orderEvent.create({ data: { orderId: o.id, type: "delivered", source: "ADMIN", occurredAt: new Date() } });
    await processClientPush(prisma);
    const titles = (await prisma.appNotice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })).map((n) => n.title);
    expect(titles).toEqual(["Paquete recibido", "Envío entregado"]); // «salió a ruta» apagado por defecto
    await processClientPush(prisma); // no repite
    expect(await prisma.appNotice.count({ where: { userId } })).toBe(2);
  });
});
