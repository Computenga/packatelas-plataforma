import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, registerScan, routeOptions, setMlRoutes, familyBase } from "./index.ts";

const n = 700000 + Number(String(Date.now()).slice(-5));
const seller = BigInt(Date.now()) * 7n;
let acc: string, main: { client: string; branch: string }, sub: { client: string; branch: string }, other: string;

async function client(publicId: string, tariff: number) {
  const c = await prisma.client.create({
    data: { publicId, name: publicId, paymentReference: publicId.toUpperCase(), tariffAmount: tariff, branches: { create: { name: `Suc ${publicId}`, address: "X" } } },
    include: { branches: true },
  });
  return { client: c.id, branch: c.branches[0].id };
}

beforeAll(async () => {
  main = await client(`cmx${n}`, 100);
  sub = await client(`cmx${n}-norte`, 80);
  other = (await client(`cmx${n + 1}`, 50)).branch;
  acc = (await prisma.mlAccount.create({ data: { mlUserId: seller, nickname: "CUENTA_FAM", clientId: main.client, routes: { create: { branchId: main.branch, isDefault: true } } } })).id;
});

afterAll(async () => {
  const cs = await prisma.client.findMany({ where: { publicId: { startsWith: `cmx${n}` } }, select: { id: true } });
  const ids = [...cs.map((c) => c.id), ...(await prisma.client.findMany({ where: { publicId: `cmx${n + 1}` } })).map((c) => c.id)];
  const orders = await prisma.order.findMany({ where: { clientId: { in: ids } }, select: { id: true } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityId: acc } });
  await prisma.mlAccount.deleteMany({ where: { id: acc } });
  await prisma.branch.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("enrutamiento ML a varias sucursales", () => {
  it("ofrece sucursales del cliente y de sus subcuentas, no de otros", async () => {
    expect(familyBase("cmx00127-granjas")).toBe("cmx00127");
    const ids = (await routeOptions(prisma, acc)).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([main.branch, sub.branch]));
    expect(ids).not.toContain(other);
    expect(await setMlRoutes(prisma, acc, { branchIds: [main.branch, other], defaultBranchId: main.branch })).toMatchObject({ ok: false });
  });

  it("al escanear usa la sucursal indicada en bodega y cobra a esa subcuenta", async () => {
    expect(await setMlRoutes(prisma, acc, { branchIds: [main.branch, sub.branch], defaultBranchId: main.branch })).toEqual({ ok: true });
    const qr = (id: number) => JSON.stringify({ id: String(40000000000 + id), sender_id: Number(seller) });
    const a = await registerScan(prisma, { raw: qr(n * 10 + 1) });
    const b = await registerScan(prisma, { raw: qr(n * 10 + 2), branchHint: sub.branch });
    const c = await registerScan(prisma, { raw: qr(n * 10 + 3), branchHint: other }); // ajena: se ignora
    const get = async (r: typeof a) => (r.status === "created" ? prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { ledger: true } }) : null);
    const [oa, ob, oc] = await Promise.all([get(a), get(b), get(c)]);
    expect([oa?.branchId, oa?.clientId, oa?.ledger[0]?.amount.toString()]).toEqual([main.branch, main.client, "100"]);
    expect([ob?.branchId, ob?.clientId, ob?.ledger[0]?.amount.toString()]).toEqual([sub.branch, sub.client, "80"]);
    expect(oc?.branchId).toBe(main.branch);
  });
});
