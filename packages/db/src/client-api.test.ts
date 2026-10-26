import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addOrderEvent, assertPublicUrl, authenticateApiKey, createApiKey, createManualOrder, prisma, processWebhooks,
  retryWebhook, revokeApiKey, saveWebhook, signWebhook, webhookSecret,
} from "./index.ts";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const n = Math.floor(Math.random() * 1e6);
let clientId = "";
const publicDns = (async () => [{ address: "93.184.216.34", family: 4 }]) as never;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: `api${n}`, name: "API test", paymentReference: `API${n}`, tariffAmount: 50 } })).id;
});
afterAll(async () => {
  await prisma.webhookDelivery.deleteMany({ where: { endpoint: { clientId } } });
  await prisma.webhookEndpoint.deleteMany({ where: { clientId } });
  await prisma.apiKey.deleteMany({ where: { clientId } });
  const orders = await prisma.order.findMany({ where: { clientId }, select: { id: true } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("llaves de API", () => {
  it("autentica solo con la llave completa y deja de servir al revocarla", async () => {
    const { key, id } = await createApiKey(prisma, clientId, "ERP");
    expect(key.startsWith("pk_live_")).toBe(true);
    expect((await authenticateApiKey(prisma, key))?.clientId).toBe(clientId);
    expect(await authenticateApiKey(prisma, key.slice(0, -1) + "x")).toBeNull();
    expect(await prisma.apiKey.count({ where: { hash: key } })).toBe(0); // no se guarda en claro
    expect(await revokeApiKey(prisma, clientId, id)).toBe(true);
    expect(await authenticateApiKey(prisma, key)).toBeNull();
  });
});

describe("webhooks", () => {
  it("rechaza URLs internas o sin https", async () => {
    await expect(assertPublicUrl("http://ejemplo.com/hook", publicDns)).rejects.toThrow(/https/);
    await expect(assertPublicUrl("https://localhost/hook", publicDns)).rejects.toThrow(/público/);
    await expect(assertPublicUrl("https://10.0.0.5/hook", publicDns)).rejects.toThrow(/público/);
    await expect(assertPublicUrl("https://osrm:5000/x", publicDns)).rejects.toThrow(/público/);
    const privateDns = (async () => [{ address: "192.168.1.10", family: 4 }]) as never;
    await expect(assertPublicUrl("https://interno.ejemplo.com/x", privateDns)).rejects.toThrow(/público/);
    expect((await assertPublicUrl("https://api.ejemplo.com/hook", publicDns)).hostname).toBe("api.ejemplo.com");
  });

  it("encola al cambiar de estado, firma y reintenta si el servidor falla", async () => {
    const ep = await saveWebhook(prisma, clientId, "https://api.ejemplo.com/hook", publicDns);
    const order = await createManualOrder(prisma, { clientId, recipientName: "Ficticio", addressLine: "Calle Falsa 123" });
    await prisma.order.update({ where: { id: order.id }, data: { externalRef: `REF-${n}` } });
    await addOrderEvent(prisma, { orderId: order.id, type: "assigned", source: "ADMIN", toStatus: "ASSIGNED" });
    const pending = await prisma.webhookDelivery.findMany({ where: { endpointId: ep.id } });
    expect(pending).toHaveLength(1);

    const calls: { headers: Record<string, string>; body: string }[] = [];
    const ok = (async (_u: string, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response("", { status: calls.length === 1 ? 500 : 200 });
    }) as typeof fetch;

    expect(await processWebhooks(prisma, { fetchImpl: ok, resolve: publicDns })).toMatchObject({ failed: 1 });
    let d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: pending[0].id } });
    expect(d).toMatchObject({ status: "PENDING", attempts: 1, responseCode: 500 });
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date() } });
    expect(await processWebhooks(prisma, { fetchImpl: ok, resolve: publicDns })).toMatchObject({ sent: 1 });
    d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(d.status).toBe("SENT");

    const last = calls[1];
    const body = JSON.parse(last.body);
    expect(body).toMatchObject({ evento: "envio.estado", codigo: order.code, referencia: `REF-${n}`, estado: "ASSIGNED", estado_anterior: "CREATED" });
    const secret = webhookSecret((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { clientId } })).secret);
    expect(last.headers["X-Packatelas-Signature"]).toBe(`sha256=${signWebhook(secret, Number(last.headers["X-Packatelas-Timestamp"]), last.body)}`);
  });

  it("tras 8 intentos queda fallido y se puede reintentar a mano", async () => {
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpoint: { clientId } } });
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "PENDING", attempts: 7, nextAttemptAt: new Date() } });
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await processWebhooks(prisma, { fetchImpl: down, resolve: publicDns });
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("FAILED");
    expect(await retryWebhook(prisma, clientId, d.id)).toBe(true);
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("PENDING");
  });
});
