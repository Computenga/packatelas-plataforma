import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countMlNotification, encryptSecret, mlLiveProbe, mlNotificationStats, prisma, requeueStaleMlOrders } from "./index.ts";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const n = 810000 + Number(String(Date.now()).slice(-5));
const seller = 710000000 + Number(String(Date.now()).slice(-6));
const base = 47000000000 + Number(String(Date.now()).slice(-6)) * 10;
const IDS = [base + 1, base + 2, base + 3, base + 4];
// En vivo: 1 entregado (y en el portal decía en camino → desfasado), 2 en camino (la app dice entregado → solo app),
// 3 en camino (pendiente), 4 límite 429.
const LIVE: Record<number, { status: string; substatus: string | null } | 429> = {
  [IDS[0]]: { status: "delivered", substatus: null },
  [IDS[1]]: { status: "shipped", substatus: "out_for_delivery" },
  [IDS[2]]: { status: "shipped", substatus: "out_for_delivery" },
  [IDS[3]]: 429,
};
const fakeFetch = (async (url: string | URL) => {
  const id = Number(/\/shipments\/(\d+)$/.exec(String(url))?.[1]);
  const v = LIVE[id];
  if (v === 429) return new Response("{}", { status: 429 });
  return new Response(JSON.stringify({ id, ...v }), { status: 200 });
}) as typeof fetch;
let clientId = "";

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: `mlh${n}`, name: "ML salud", paymentReference: `MLH${n}`, tariffAmount: 0 } })).id;
  const acc = await prisma.mlAccount.create({ data: { mlUserId: BigInt(seller), nickname: "T", clientId, accessTokenEnc: encryptSecret("AT"), refreshTokenEnc: encryptSecret("RT"), tokenExpiresAt: new Date(Date.now() + 3600_000) } });
  const mk = (i: number, status: "OUT_FOR_DELIVERY" | "DELIVERED") =>
    prisma.order.create({ data: { code: `ML-${IDS[i]}`, clientId, mlAccountId: acc.id, mlShipmentId: BigInt(IDS[i]), mlStatus: "shipped", mlSubstatus: "out_for_delivery", status, addressLine: "X", recipientName: "Ficticio", source: "ML_FLEX" } });
  await mk(0, "OUT_FOR_DELIVERY");
  await mk(1, "DELIVERED");
  await mk(2, "OUT_FOR_DELIVERY");
  await mk(3, "OUT_FOR_DELIVERY");
});
afterAll(async () => {
  await prisma.mlJob.deleteMany({ where: { key: { in: IDS.map((i) => `shipment:${i}`) } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("salud de la API de ML", () => {
  it("compara ML en vivo con el portal y la app, y detecta límites", async () => {
    const r = await mlLiveProbe(prisma, { fetchImpl: fakeFetch, limit: 500, resync: true });
    const mine = r.rows.filter((x) => IDS.some((i) => x.code === `ML-${i}`));
    const v = Object.fromEntries(mine.map((x) => [x.code, x.verdict]));
    expect(v[`ML-${IDS[0]}`]).toBe("desfasado");
    expect(v[`ML-${IDS[1]}`]).toBe("solo_app");
    expect(v[`ML-${IDS[2]}`]).toBe("pendiente");
    expect(v[`ML-${IDS[3]}`]).toBe("error");
    expect(r.rateLimited).toBeGreaterThanOrEqual(1);
    // El desfasado quedó en la cola para sincronizarse.
    expect(await prisma.mlJob.findUnique({ where: { key: `shipment:${IDS[0]}` } })).toMatchObject({ status: "PENDING" });
  });

  it("re-encola los pedidos en ruta sin sincronizar reciente", async () => {
    await prisma.mlJob.updateMany({ where: { key: `shipment:${IDS[0]}` }, data: { status: "DONE" } });
    const later = new Date(Date.now() + 60 * 60_000);
    expect(await requeueStaleMlOrders(prisma, { now: later, limit: 5000 })).toBeGreaterThanOrEqual(4);
    expect(await requeueStaleMlOrders(prisma, { now: later, limit: 5000 })).toBe(0); // ya están en espera
  });

  it("cuenta los avisos por hora", async () => {
    const before = (await mlNotificationStats(prisma)).total24;
    await countMlNotification(prisma);
    const s = await mlNotificationStats(prisma);
    expect(s.total24).toBe(before + 1);
    expect(s.lastAt).not.toBeNull();
  });
});
