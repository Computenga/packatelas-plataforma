import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma, waPhone, renderPreview, enqueueNotification, deliverPending, notifyOrderStatus, sendWeeklyReminders,
  createManualOrder, getNotifySettings, type Sender,
} from "./index.ts";

const tag = `nt${Date.now()}`;
let clientId = "";

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Tienda Avisos", contactName: "Rosa Pérez", phone: "55 1234 5678", paymentReference: tag.toUpperCase(), tariffAmount: 100 } })).id;
});
afterAll(async () => {
  const orders = await prisma.order.findMany({ where: { clientId }, select: { id: true } });
  await prisma.notification.deleteMany({ where: { OR: [{ clientId }, { dedupeKey: { startsWith: tag } }] } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("formato", () => {
  it("normaliza teléfonos de México", () => {
    expect(waPhone("55 1234 5678")).toBe("525512345678");
    expect(waPhone("+52 1 55 1234 5678")).toBe("525512345678");
    expect(waPhone("525512345678")).toBe("525512345678");
    expect(waPhone("1234")).toBeNull();
  });
  it("arma el texto de la plantilla", () => {
    expect(renderPreview("entregado", ["Ana", "Tienda", "PK-1"])).toBe("Hola Ana, entregamos tu pedido de Tienda (PK-1). ¡Gracias!");
  });
});

describe("cola de avisos", () => {
  it("no duplica, y se envía, falla o se omite según el resultado", async () => {
    expect(await enqueueNotification(prisma, { event: "entregado", to: "5512345678", params: ["A", "B", "C"], dedupeKey: `${tag}-1`, clientId })).toBe(true);
    expect(await enqueueNotification(prisma, { event: "entregado", to: "5512345678", params: ["A", "B", "C"], dedupeKey: `${tag}-1`, clientId })).toBe(false);
    expect(await enqueueNotification(prisma, { event: "entregado", to: "123", params: [], dedupeKey: `${tag}-x`, clientId })).toBe(false);
    await enqueueNotification(prisma, { event: "entregado", to: "5599990000", params: ["A", "B", "C"], dedupeKey: `${tag}-2`, clientId });

    const calls: string[] = [];
    const sender: Sender = async (n) => {
      calls.push(n.to);
      return n.to.endsWith("5678") ? { ok: true, id: "wamid.1" } : { ok: false, error: "Número no tiene WhatsApp", permanent: true };
    };
    await deliverPending(prisma, sender, 500);
    const rows = await prisma.notification.findMany({ where: { dedupeKey: { in: [`${tag}-1`, `${tag}-2`] } }, orderBy: { dedupeKey: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["SENT", "FAILED"]);
    expect(rows[0].externalId).toBe("wamid.1");

    await enqueueNotification(prisma, { event: "entregado", to: "5511112222", params: ["A", "B", "C"], dedupeKey: `${tag}-3`, clientId });
    await deliverPending(prisma, null, 500);
    expect((await prisma.notification.findUniqueOrThrow({ where: { dedupeKey: `${tag}-3` } })).status).toBe("SKIPPED");
  });

  it("avisos de un pedido según su estado, una vez por intento", async () => {
    const o = await createManualOrder(prisma, { clientId, recipientName: "Luis Gómez", recipientPhone: "5587654321", addressLine: "Calle 1" });
    await prisma.order.update({ where: { id: o.id }, data: { status: "OUT_FOR_DELIVERY" } });
    await notifyOrderStatus(prisma, o.id, { trackingUrl: "https://x/s/abc" });
    await notifyOrderStatus(prisma, o.id, { trackingUrl: "https://x/s/abc" });
    await prisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
    await notifyOrderStatus(prisma, o.id, { trackingUrl: "https://x/s/abc" });
    const n = await prisma.notification.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });
    expect(n.map((x) => x.event)).toEqual(["en_camino", "entregado"]);
    expect(n[0].preview).toContain("Hola Luis, tu pedido de Tienda Avisos");
    expect(n[0].preview).toContain("https://x/s/abc");
  });

  it("recordatorio semanal solo el día y hora configurados", async () => {
    await prisma.ledgerEntry.create({ data: { clientId, type: "ADJUSTMENT", amount: 350, description: "deuda prueba" } });
    const s = await getNotifySettings(prisma);
    expect(s.reminderWeekday).toBe(6);
    const friday = new Date("2026-10-30T12:00:00-06:00");
    const saturdayEarly = new Date("2026-10-31T08:00:00-06:00");
    const saturday = new Date("2026-10-31T10:30:00-06:00");
    expect(await sendWeeklyReminders(prisma, friday)).toBe(0);
    expect(await sendWeeklyReminders(prisma, saturdayEarly)).toBe(0);
    await sendWeeklyReminders(prisma, saturday);
    const r = await prisma.notification.findFirst({ where: { clientId, event: "recordatorio_pago" } });
    expect(r?.preview).toMatch(/^Hola Rosa, tu saldo con Packatelas es de \$/);
    expect(r?.to).toBe("525512345678");
  });
});

describe("plantillas de WhatsApp", () => {
  it("cumplen las reglas de Meta: sin variable al inicio ni al final y con ejemplo por variable", async () => {
    const { NOTIFY_EVENTS, whatsappTemplatePayload } = await import("./notifications.ts");
    for (const ev of Object.keys(NOTIFY_EVENTS) as (keyof typeof NOTIFY_EVENTS)[]) {
      const p = whatsappTemplatePayload(ev);
      const text = p.components[0].text;
      const vars = text.match(/\{\{\d\}\}/g) ?? [];
      expect(text.trim().startsWith("{{"), ev).toBe(false);
      expect(text.trim().endsWith("}}"), ev).toBe(false);
      expect(p.components[0].example.body_text[0]).toHaveLength(vars.length);
      expect(p.name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
