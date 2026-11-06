import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma, getClientBalance, placeStoreOrder, storeOrdersAfterPickup, syncStoreCatalog } from "./index.ts";

const tag = `st${Date.now()}`;
let clientId: string, branchId: string, userId: string, productId: string;
const res = (b: unknown) => new Response(JSON.stringify(b));
const woo = (async () => res([
  { id: 990001, name: "Bolsas 28&#215;40", type: "simple", sku: "B2840", is_in_stock: true, prices: { price: "13500", currency_minor_unit: 2 }, categories: [{ name: "Insumos" }], images: [{ src: "https://x/b.jpg" }] },
  { id: 990002, name: "Prepago de Envíos", type: "simple", sku: "", prices: { price: "500", currency_minor_unit: 2 } },
  { id: 990003, name: "Despachador", type: "variable", sku: "", prices: { price: "82000", currency_minor_unit: 2 } },
])) as unknown as typeof fetch;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Tienda insumos", paymentReference: tag, tariffAmount: 85 } })).id;
  branchId = (await prisma.branch.create({ data: { clientId, name: "Matriz", address: "Calle 1" } })).id;
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});
afterAll(async () => {
  const orders = await prisma.storeOrder.findMany({ where: { clientId }, select: { pickupId: true } });
  await prisma.storeOrder.deleteMany({ where: { clientId } });
  for (const o of orders) if (o.pickupId) { await prisma.order.deleteMany({ where: { pickupId: o.pickupId } }); await prisma.pickup.deleteMany({ where: { id: o.pickupId } }); }
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.storeProduct.deleteMany({ where: { wooId: { in: [990001, 990002, 990003] } } });
  await prisma.$disconnect();
});

describe("tienda de insumos [P17]", () => {
  it("copia solo productos simples y vendibles de WooCommerce", async () => {
    await syncStoreCatalog(prisma, woo);
    const p = await prisma.storeProduct.findUniqueOrThrow({ where: { wooId: 990001 } });
    expect(p.name).toBe("Bolsas 28×40");
    expect(Number(p.price)).toBe(135);
    expect(await prisma.storeProduct.count({ where: { wooId: { in: [990002, 990003] } } })).toBe(0);
    productId = p.id;
  });

  it("con saldo a favor: se paga, se agenda con la recolección y se entrega al recolectar", async () => {
    await expect(placeStoreOrder(prisma, { clientId, userId, branchId, cart: [{ productId, qty: 2 }], pay: "saldo", baseUrl: "x" })).rejects.toThrow(/no alcanza/);
    await prisma.ledgerEntry.create({ data: { clientId, type: "PAYMENT", amount: new Prisma.Decimal(-300), description: "abono" } });
    const r = await placeStoreOrder(prisma, { clientId, userId, branchId, cart: [{ productId, qty: 2 }], pay: "saldo", baseUrl: "x" });
    const o = await prisma.storeOrder.findUniqueOrThrow({ where: { id: r.id } });
    expect(o.status).toBe("PAID");
    expect(Number(o.total)).toBe(270);
    expect(o.pickupId).toBeTruthy();
    expect(Number(await getClientBalance(prisma, clientId))).toBe(-30);
    await storeOrdersAfterPickup(prisma, o.pickupId!, true);
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("DELIVERED");
  });
});

describe("precio del portal", () => {
  it("usa el del portal si lo hay; si no, el de WooCommerce", async () => {
    const { storePrice } = await import("./store.ts");
    expect(storePrice({ price: "120.00", portalPrice: null })).toBe(120);
    expect(storePrice({ price: "120.00", portalPrice: "99.50" })).toBe(99.5);
  });
});
