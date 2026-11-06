import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { importMlAccounts, prisma, registerScan, UNLINKED_PUBLIC_ID } from "./index.ts";

const t = String(Date.now()).slice(-6);
const seller = 650000000 + Number(t);
const ship = 47500000000 + Number(t);
let clientId = "";

afterAll(async () => {
  const orders = await prisma.order.findMany({ where: { mlShipmentId: BigInt(ship) }, select: { id: true } });
  await prisma.ledgerEntry.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  await prisma.mlAccountRoute.deleteMany({ where: { mlAccount: { mlUserId: BigInt(seller) } } });
  await prisma.mlAccount.deleteMany({ where: { mlUserId: BigInt(seller) } });
  if (clientId) { await prisma.branch.deleteMany({ where: { clientId } }); await prisma.client.delete({ where: { id: clientId } }); }
  await prisma.$disconnect();
});

describe("vendedor de ML sin ligar", () => {
  it("el paquete se registra en «ML por identificar» y al ligarlo pasa al cliente con su cobro", async () => {
    const raw = JSON.stringify({ id: String(ship), sender_id: seller, hash_code: null, security_digit: null });
    expect((await registerScan(prisma, { raw })).status).toBe("unknown_account");
    const r = await registerScan(prisma, { raw, allowUnknown: true });
    expect(r.status).toBe("created");
    const o = await prisma.order.findUniqueOrThrow({ where: { mlShipmentId: BigInt(ship) }, include: { client: true } });
    expect(o.client.publicId).toBe(UNLINKED_PUBLIC_ID);
    expect(await prisma.ledgerEntry.count({ where: { orderId: o.id } })).toBe(0);

    const c = await prisma.client.create({ data: { publicId: `mlu${t}`, name: "Tienda ML", paymentReference: `MLU${t}`, tariffAmount: 85, branches: { create: { name: "Matriz", address: "Calle 1" } } } });
    clientId = c.id;
    const imp = await importMlAccounts(prisma, [{ line: 1, sellerId: String(seller), nickname: "", publicId: c.publicId }], (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id);
    expect(imp.ok).toBe(true);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.clientId).toBe(c.id);
    expect(Number((await prisma.ledgerEntry.findFirstOrThrow({ where: { orderId: o.id, type: "CHARGE" } })).amount)).toBe(85);
  });
});
