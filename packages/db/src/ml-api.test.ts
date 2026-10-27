import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectMlAccount, mapMlShipment, prisma, readMlState, syncMlShipment, registerScan, signMlState, ML_PENDING_ADDRESS } from "./index.ts";

process.env.ML_CLIENT_ID = "123";
process.env.ML_CLIENT_SECRET = "s";
process.env.PUBLIC_URL = "https://ejemplo.mx";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const n = 900000 + Number(String(Date.now()).slice(-5));
const seller = Number(String(Date.now()).slice(-9));
let clientId: string;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const shipment = { id: 1, status: "ready_to_ship", substatus: "printed", order_id: 2000012345, destination: { receiver_name: "Ana López", receiver_phone: "5512345678", shipping_address: { address_line: "Lago Zurich 245", zip_code: "11529", city: { name: "Miguel Hidalgo" }, state: { name: "Distrito Federal" }, neighborhood: { name: "Ampliación Granada" }, latitude: 19.44, longitude: -99.2, comment: "Casa azul" } } };
const fakeFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.endsWith("/oauth/token")) return json({ access_token: "AT", refresh_token: "RT", expires_in: 21600, user_id: seller });
  if (u.endsWith("/users/me")) return json({ id: seller, nickname: "TIENDA_PRUEBA" });
  if (/\/shipments\/\d+\/items$/.test(u)) return json([{ description: "Taza", quantity: 2 }]);
  if (/\/shipments\/\d+$/.test(u)) return json(shipment);
  return json({}, 404);
}) as typeof fetch;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: `cmx${n}`, name: "ML test", paymentReference: `CMX${n}`, tariffAmount: 0, branches: { create: { name: "P", address: "X" } } } })).id;
});
afterAll(async () => {
  const orders = await prisma.order.findMany({ where: { clientId }, select: { id: true, mlShipmentId: true } });
  await prisma.mlJob.deleteMany({ where: { key: { in: orders.map((o) => `shipment:${o.mlShipmentId}`) } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("MercadoLibre", () => {
  it("firma el estado del OAuth y lo rechaza alterado o vencido", () => {
    const s = signMlState("abc");
    expect(readMlState(s)).toBe("abc");
    expect(readMlState(s.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(readMlState(signMlState("abc", 1, Date.now() - 2 * 86_400_000))).toBeNull();
  });

  it("lee el envío en formato nuevo y anterior", () => {
    expect(mapMlShipment(shipment)).toMatchObject({ recipientName: "Ana López", addressLine: "Lago Zurich 245", zip: "11529", city: "Miguel Hidalgo", lat: 19.44, mlStatus: "ready_to_ship", mlOrderId: 2000012345n });
    expect(mapMlShipment({ status: "shipped", receiver_address: { street_name: "Reforma", street_number: "222", zip_code: "06600", city: { name: "Cuauhtémoc" }, latitude: 0 } })).toMatchObject({ addressLine: "Reforma 222", lat: null, mlStatus: "shipped" });
  });

  it("conecta la cuenta, y el envío escaneado se completa con datos de ML", async () => {
    const r = await connectMlAccount(prisma, { code: "C", state: signMlState(clientId) }, fakeFetch);
    expect(r).toMatchObject({ ok: true, nickname: "TIENDA_PRUEBA" });
    const acc = await prisma.mlAccount.findUniqueOrThrow({ where: { mlUserId: BigInt(seller) }, include: { routes: true } });
    expect(acc.status).toBe("ACTIVE");
    expect(acc.accessTokenEnc).not.toContain("AT");
    expect(acc.routes).toHaveLength(1);

    const sid = BigInt(Date.now()) * 3n;
    const scan = await registerScan(prisma, { raw: JSON.stringify({ id: String(sid), sender_id: seller }) });
    expect(scan.status).toBe("created");
    expect((await prisma.order.findUniqueOrThrow({ where: { mlShipmentId: sid } })).addressLine).toBe(ML_PENDING_ADDRESS);
    expect(await prisma.mlJob.findUnique({ where: { key: `shipment:${sid}` } })).toMatchObject({ status: "PENDING" });
    expect(await syncMlShipment(prisma, sid, fakeFetch)).toEqual({ status: "synced" });
    const o = await prisma.order.findUniqueOrThrow({ where: { mlShipmentId: sid } });
    expect(o).toMatchObject({ addressLine: "Lago Zurich 245", recipientName: "Ana López", lat: 19.44, itemsSummary: "2× Taza", instructions: "Casa azul", mlStatus: "ready_to_ship" });
  });

  it("si la cuenta ya es de otro cliente, la autoriza donde está y no la mueve", async () => {
    const other = await prisma.client.create({ data: { publicId: `emx${n}`, name: "Otro", paymentReference: `EMX${n}`, tariffAmount: 0 } });
    const before = await prisma.mlAccount.findFirstOrThrow({ where: { mlUserId: BigInt(seller) } });
    const r = await connectMlAccount(prisma, { code: "C", state: signMlState(other.id) }, fakeFetch);
    expect(r).toMatchObject({ ok: true, elsewhere: { publicId: expect.any(String) } });
    const after = await prisma.mlAccount.findFirstOrThrow({ where: { mlUserId: BigInt(seller) } });
    expect(after.clientId).toBe(before.clientId);
    expect(after.status).toBe("ACTIVE");
    await prisma.client.delete({ where: { id: other.id } });
  });
});
