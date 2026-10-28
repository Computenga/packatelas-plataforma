import "dotenv/config";
import { deflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureShipment, encryptSecret, firstFileFromZip, isFullMlQr, prisma, qrFromZpl, registerScan, sweepFlexShipments } from "./index.ts";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.ML_CLIENT_ID = "123";
process.env.ML_CLIENT_SECRET = "s";

const n = 800000 + Number(String(Date.now()).slice(-5));
const seller = 700000000 + Number(String(Date.now()).slice(-6));
const base = 46000000000 + Number(String(Date.now()).slice(-6)) * 10;
const FLEX = base + 1, FLEX2 = base + 2, COLECTA = base + 3;
const QR = (id: number) => JSON.stringify({ id: String(id), sender_id: seller, hash_code: "Abc+/9xYz=", security_digit: "0" });
let clientId = "", accountId = "";
const calls: string[] = [];

// ZPL como lo manda ML: QR con modo «LA,» y escapes ^FH (_7B = «{», _22 = «"»).
const zplFor = (id: number) => {
  const esc = QR(id).replace(/[{}"]/g, (c) => "_" + c.charCodeAt(0).toString(16).toUpperCase());
  return `^XA^CI28^FO50,50^A0N,30,30^FDEnvio Flex^FS^FO300,400^FH^BQN,2,6^FDLA,${esc}^FS^XZ`;
};
const zip = (content: string) => {
  const data = deflateRawSync(Buffer.from(content));
  const name = Buffer.from("Etiqueta de envio.txt");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt16LE(name.length, 26);
  return Buffer.concat([h, name, data, Buffer.from([0x50, 0x4b, 0x01, 0x02])]);
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const ship = (id: number, type: string, sub = "printed") => ({
  id, status: "ready_to_ship", substatus: sub, order_id: 2000000000 + (id % 1000), date_created: "2026-10-27T10:00:00.000-06:00",
  logistic: { type, mode: "me2" }, lead_time: { estimated_delivery_time: { date: "2026-10-28T22:00:00.000-06:00" } },
  destination: { receiver_name: "Ana Ficticia", receiver_phone: "5500000000", shipping_address: { address_line: "Calle Falsa 123", zip_code: "06800", neighborhood: { name: "Obrera" }, city: { name: "Cuauhtémoc" }, state: { name: "CDMX" }, latitude: 19.41, longitude: -99.14, comment: "Portón negro" } },
});
const fakeFetch = (async (url: string | URL) => {
  const u = String(url);
  calls.push(u);
  if (u.includes("/orders/search")) return json({ results: [{ shipping: { id: FLEX } }, { shipping: { id: FLEX2 } }, { shipping: { id: COLECTA } }, { shipping: null }], paging: { total: 4 } });
  if (/\/orders\/\d+$/.test(u)) return json({ buyer: { nickname: "COMPRADOR_X" }, pack_id: null });
  if (u.includes("/shipment_labels")) {
    const id = Number(/shipment_ids=(\d+)/.exec(u)![1]);
    return new Response(zip(zplFor(id)), { headers: { "content-type": "application/zip" } });
  }
  if (/\/shipments\/\d+\/items$/.test(u)) return json([{ description: "Audífonos", quantity: 1 }]);
  const m = /\/shipments\/(\d+)$/.exec(u);
  if (m) {
    const id = Number(m[1]);
    return json(id === COLECTA ? ship(id, "cross_docking") : ship(id, "self_service", id === FLEX2 ? "ready_to_print" : "printed"));
  }
  return json({}, 404);
}) as typeof fetch;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: `flx${n}`, name: "Flex test", paymentReference: `FLX${n}`, tariffAmount: 0, branches: { create: { name: "P", address: "X" } } } })).id;
  const branch = await prisma.branch.findFirstOrThrow({ where: { clientId } });
  accountId = (await prisma.mlAccount.create({
    data: { mlUserId: BigInt(seller), nickname: "TIENDA_FLEX", clientId, accessTokenEnc: encryptSecret("AT"), refreshTokenEnc: encryptSecret("RT"), tokenExpiresAt: new Date(Date.now() + 3600_000), routes: { create: { branchId: branch.id, isDefault: true } } },
  })).id;
});
afterAll(async () => {
  const orders = await prisma.order.findMany({ where: { clientId }, select: { id: true, mlShipmentId: true } });
  await prisma.mlFlexShipment.deleteMany({ where: { clientId } });
  await prisma.mlJob.deleteMany({ where: { key: { in: orders.map((o) => `shipment:${o.mlShipmentId}`) } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("QR de la etiqueta", () => {
  it("extrae el QR con hash de un ZPL con modo y escapes ^FH", () => {
    expect(qrFromZpl(zplFor(FLEX))).toBe(QR(FLEX));
    expect(qrFromZpl("^XA^FO1,1^BQN,2,5^FDQA,{\"id\":\"46972264194\",\"hash_code\":\"h\"}^FS^XZ")).toBe('{"id":"46972264194","hash_code":"h"}');
    expect(firstFileFromZip(zip("hola"))?.toString()).toBe("hola");
    expect(isFullMlQr(QR(FLEX))).toBe(true);
    expect(isFullMlQr(JSON.stringify({ id: String(FLEX), sender_id: seller }))).toBe(false);
  });
});

describe("Recuperados", () => {
  it("el barrido trae todos los Flex de la cuenta, ignora los que no son Flex y no marca como impreso", async () => {
    const r = await sweepFlexShipments(prisma, { fetchImpl: fakeFetch });
    expect(r.flex).toBe(2);
    const rows = await prisma.mlFlexShipment.findMany({ where: { clientId }, orderBy: { shipmentId: "asc" } });
    expect(rows.map((x) => x.logisticType)).toEqual(["self_service", "self_service", "cross_docking"]);
    const [a, b] = rows;
    expect(a).toMatchObject({ recipientName: "Ana Ficticia", zip: "06800", buyerNickname: "COMPRADOR_X", itemsSummary: "1× Audífonos", qrRaw: QR(FLEX), orderId: null });
    // Aún sin imprimir por el vendedor: no se pide la etiqueta.
    expect(b.qrRaw).toBeNull();
    expect(calls.some((c) => c.includes(`shipment_ids=${FLEX2}`))).toBe(false);
    // Segunda vuelta: no vuelve a consultar envíos conocidos.
    const before = calls.length;
    await sweepFlexShipments(prisma, { fetchImpl: fakeFetch });
    expect(calls.slice(before).filter((c) => /\/shipments\/\d+$/.test(c))).toHaveLength(0);
  });

  it("al escanearlo pasa al histórico, nace con dirección y guarda el QR con hash", async () => {
    const s = await registerScan(prisma, { raw: QR(FLEX2) });
    expect(s.status).toBe("created");
    const order = await prisma.order.findUniqueOrThrow({ where: { mlShipmentId: BigInt(FLEX2) } });
    expect(order).toMatchObject({ addressLine: "Calle Falsa 123", recipientName: "Ana Ficticia", mlQrRaw: QR(FLEX2) });
    const row = await prisma.mlFlexShipment.findUniqueOrThrow({ where: { shipmentId: BigInt(FLEX2) } });
    expect(row.orderId).toBe(order.id);
    expect(row.scannedAt).not.toBeNull();
    expect(row.qrRaw).toBe(QR(FLEX2));
    // Una lectura de PDA (solo número) no borra el QR guardado.
    await registerScan(prisma, { raw: String(FLEX2) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).mlQrRaw).toBe(QR(FLEX2));
  });

  it("un aviso de un envío ya escaneado lo liga a su pedido", async () => {
    await prisma.mlFlexShipment.update({ where: { shipmentId: BigInt(FLEX2) }, data: { orderId: null, scannedAt: null } });
    await captureShipment(prisma, accountId, BigInt(FLEX2), fakeFetch);
    expect((await prisma.mlFlexShipment.findUniqueOrThrow({ where: { shipmentId: BigInt(FLEX2) } })).orderId).not.toBeNull();
  });
});
