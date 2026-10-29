import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { driverIdFrom, encryptSecret, linkFlexDriver, lookupFlexDriver, prisma } from "./index.ts";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.ML_CLIENT_ID = "123";
process.env.ML_CLIENT_SECRET = "s";

const n = Number(String(Date.now()).slice(-6));
const seller = 600000000 + n;
const SID = 45000000000 + n;
const FLEX_DRIVER = 88000000 + n;
let clientId = "", driverA = "", driverB = "", userA = "", userB = "", adminId = "";
let assigned = true;
const calls: string[] = [];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const fakeFetch = (async (url: string | URL) => {
  const u = String(url);
  calls.push(u);
  if (u.includes("/assignment/v1")) return assigned ? json({ shipment_id: SID, driver_id: FLEX_DRIVER, status: "assigned" }) : json({ message: "not found" }, 404);
  if (u.endsWith(`/users/${FLEX_DRIVER}`)) return json({ id: FLEX_DRIVER, nickname: "DRIVERFLEX" });
  return json({}, 404);
}) as typeof fetch;

beforeAll(async () => {
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  clientId = (await prisma.client.create({ data: { publicId: `fdx${n}`, name: "Flex drivers test", paymentReference: `FDX${n}`, tariffAmount: 0 } })).id;
  await prisma.mlAccount.create({ data: { mlUserId: BigInt(seller), nickname: "VEND", clientId, accessTokenEnc: encryptSecret("SELLER_AT"), tokenExpiresAt: new Date(Date.now() + 3600_000) } });
  for (const k of ["a", "b"]) {
    const u = await prisma.user.create({ data: { username: `fdx${k}${n}`, name: `Repartidor ${k.toUpperCase()}`, role: "REPARTIDOR", passwordHash: "x", driver: { create: {} } }, include: { driver: true } });
    if (k === "a") { userA = u.id; driverA = u.driver!.id; } else { userB = u.id; driverB = u.driver!.id; }
  }
});
afterAll(async () => {
  await prisma.flexIdentity.deleteMany({ where: { flexDriverId: BigInt(FLEX_DRIVER) } });
  await prisma.driver.deleteMany({ where: { id: { in: [driverA, driverB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("drivers Flex", () => {
  it("lee el driver en distintos formatos de respuesta", () => {
    expect(driverIdFrom({ driver_id: 123456 })).toBe("123456");
    expect(driverIdFrom({ driver: { id: "998877" } })).toBe("998877");
    expect(driverIdFrom({ results: [{ driver_id: 111 }, { driver_id: 222333 }] })).toBe("222333");
    expect(driverIdFrom({})).toBeNull();
  });

  it("del QR saca el driver con el token del vendedor; sin vínculo → lo vincula; luego lo mueve", async () => {
    const qr = JSON.stringify({ id: String(SID), sender_id: seller, hash_code: "h" });
    const r = await lookupFlexDriver(prisma, qr, fakeFetch);
    expect(r).toMatchObject({ ok: true, shipmentId: String(SID), flexDriverId: String(FLEX_DRIVER), nickname: "DRIVERFLEX", via: "vendedor", linked: null });
    expect(calls.some((c) => c === `https://api.mercadolibre.com/flex/sites/MLM/shipments/${SID}/assignment/v1`)).toBe(true);
    await linkFlexDriver(prisma, { flexDriverId: String(FLEX_DRIVER), driverId: driverA, shipmentId: String(SID), actorUserId: adminId });
    // Buscando solo por número de envío (sin QR): ya aparece vinculado.
    await prisma.mlFlexShipment.create({ data: { shipmentId: BigInt(SID), mlAccountId: (await prisma.mlAccount.findUniqueOrThrow({ where: { mlUserId: BigInt(seller) } })).id, clientId, logisticType: "self_service" } });
    const r2 = await lookupFlexDriver(prisma, String(SID), fakeFetch);
    expect(r2.ok && r2.linked?.name).toBe("Repartidor A");
    const m = await linkFlexDriver(prisma, { flexDriverId: String(FLEX_DRIVER), driverId: driverB, actorUserId: adminId });
    expect(m).toMatchObject({ moved: true, previous: "Repartidor A", name: "Repartidor B" });
    await prisma.mlFlexShipment.delete({ where: { shipmentId: BigInt(SID) } });
  });

  it("si ML no tiene driver asignado lo dice claro", async () => {
    assigned = false;
    const r = await lookupFlexDriver(prisma, JSON.stringify({ id: String(SID), sender_id: seller }), fakeFetch);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/no tiene un driver Flex con ruta abierta/);
    assigned = true;
  });
});
