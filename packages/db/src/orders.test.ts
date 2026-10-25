import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, parseScan, registerScan, createManualOrder, getClientBalance } from "./index.ts";

const tag = `o${Date.now()}`;
const seller = BigInt(Date.now()) * 10n; // id único de vendedor de prueba
let clientId: string;
let branchId: string;

const qr = (id: string, sender: bigint | null = seller) =>
  JSON.stringify({ id, sender_id: sender === null ? undefined : Number(sender), hash_code: "x", security_digit: "0" });

beforeAll(async () => {
  const c = await prisma.client.create({
    data: {
      publicId: tag,
      name: "Cliente Escaneo",
      paymentReference: tag,
      tariffAmount: 100,
      branches: { create: { name: "Sucursal", address: "Calle 2" } },
    },
    include: { branches: true },
  });
  clientId = c.id;
  branchId = c.branches[0].id;
  await prisma.mlAccount.create({
    data: { mlUserId: seller, nickname: "TIENDA_TEST", clientId, routes: { create: { branchId, isDefault: true } } },
  });
});

afterAll(async () => {
  const orders = await prisma.order.findMany({ where: { clientId }, select: { id: true } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("parseScan", () => {
  it("lee el QR JSON de Mercado Envíos", () => {
    expect(parseScan('{"id":"46972264194","sender_id":123456,"hash_code":"a"}')).toEqual({
      kind: "ML",
      shipmentId: 46972264194n,
      senderId: 123456n,
    });
  });
  it("acepta número suelto, ML- y códigos propios", () => {
    expect(parseScan(" 46972264194 ")).toMatchObject({ kind: "ML", shipmentId: 46972264194n, senderId: null });
    expect(parseScan("ML-46972264194")).toMatchObject({ kind: "ML", shipmentId: 46972264194n });
    expect(parseScan("pk-000012")).toEqual({ kind: "CODE", code: "PK-000012" });
  });
  it("rechaza basura", () => {
    expect(parseScan("hola").kind).toBe("INVALID");
    expect(parseScan('{"id":"12"}').kind).toBe("INVALID");
    expect(parseScan("{roto").kind).toBe("INVALID");
  });
});

describe("registerScan", () => {
  it("crea el pedido en la sucursal enrutada y cobra una sola vez aunque se escanee en paralelo", async () => {
    const id = `${Date.now()}`.slice(0, 11);
    const results = await Promise.all([1, 2, 3].map(() => registerScan(prisma, { raw: qr(id) })));
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "existing")).toHaveLength(2);

    const order = await prisma.order.findUniqueOrThrow({ where: { code: `ML-${id}` } });
    expect(order.branchId).toBe(branchId);
    expect(await prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(1);
    expect((await getClientBalance(prisma, clientId)).toString()).toBe("100");
  });

  it("avisa cuando la cuenta ML no está ligada", async () => {
    const r = await registerScan(prisma, { raw: qr("12345678901", 999n) });
    expect(r.status).toBe("unknown_account");
  });

  it("número suelto de un envío ya registrado se reconoce", async () => {
    const id = `${Date.now() + 7}`.slice(0, 11);
    await registerScan(prisma, { raw: qr(id) });
    const r = await registerScan(prisma, { raw: id });
    expect(r.status).toBe("existing");
  });
});

describe("createManualOrder", () => {
  it("asigna consecutivo PK-, registra evento y cargo", async () => {
    const a = await createManualOrder(prisma, { clientId, recipientName: "Ana", addressLine: "Calle 3" });
    const b = await createManualOrder(prisma, { clientId, recipientName: "Beto", addressLine: "Calle 4" });
    expect(a.code).toMatch(/^PK-\d{6}$/);
    expect(Number(b.code.slice(3))).toBe(Number(a.code.slice(3)) + 1);
    expect(await prisma.orderEvent.count({ where: { orderId: a.id, type: "created" } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { orderId: a.id, type: "CHARGE" } })).toBe(1);
  });
});
