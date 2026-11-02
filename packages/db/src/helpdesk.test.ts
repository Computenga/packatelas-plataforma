import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, clientReply, createTicket, staffReply } from "./index.ts";

const tag = `hd${Date.now()}`;
let clientId: string, userId: string, staffId: string;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Tienda soporte", paymentReference: tag, tariffAmount: 85 } })).id;
  userId = (await prisma.user.create({ data: { username: `${tag}-c`, name: "Tienda", role: "CLIENTE", clientId, passwordHash: "x" } })).id;
  staffId = (await prisma.user.create({ data: { username: `${tag}-s`, name: "Soporte", role: "OPERADOR", passwordHash: "x" } })).id;
  await prisma.order.create({ data: { code: `${tag}-PK1`, source: "MANUAL", clientId, addressLine: "Calle 1" } });
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, staffId] } } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("ayuda y soporte [A35]", () => {
  it("valida y liga el envío de la tienda", async () => {
    await expect(createTicket(prisma, { clientId, userId, category: "nada", subject: "Hola", text: "texto largo suficiente" })).rejects.toThrow(/Elige/);
    await expect(createTicket(prisma, { clientId, userId, category: "envio", subject: "No llega", text: "texto largo suficiente", orderRef: "PK-999" })).rejects.toThrow(/No encontramos/);
    const t = await createTicket(prisma, { clientId, userId, category: "envio", subject: "No llega", text: "Mi paquete no ha llegado", orderRef: `${tag}-pk1` });
    expect(t.orderId).toBeTruthy();
    expect(t.status).toBe("OPEN");
  });

  it("la respuesta del equipo espera a la tienda; la nota interna no; responder reabre", async () => {
    const t = await prisma.ticket.findFirstOrThrow({ where: { clientId } });
    await staffReply(prisma, { ticketId: t.id, userId: staffId, text: "Revisando con el repartidor", internal: true });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("IN_PROGRESS");
    await staffReply(prisma, { ticketId: t.id, userId: staffId, text: "Ya se entregó, te mando foto", next: "RESOLVED" });
    const r = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(r.status).toBe("RESOLVED");
    expect(r.assignedToId).toBe(staffId);
    await clientReply(prisma, { ticketId: t.id, clientId, userId, text: "No es cierto, no llegó" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("IN_PROGRESS");
    expect(await prisma.ticketMessage.count({ where: { ticketId: t.id, internal: true } })).toBe(1);
  });
});
