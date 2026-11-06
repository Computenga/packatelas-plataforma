import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma, adminMarkOrder, getClientBalance, placeStoreOrder, saveStoreProduct, storePrice } from "./index.ts";

const tag = `st${Date.now()}`;
let clientId: string, branchId: string, userId: string, productId: string;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Tienda insumos", paymentReference: tag, tariffAmount: 85 } })).id;
  branchId = (await prisma.branch.create({ data: { clientId, name: "Matriz", address: "Calle 1" } })).id;
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});
afterAll(async () => {
  const orders = await prisma.storeOrder.findMany({ where: { clientId }, select: { orderId: true } });
  await prisma.storeOrder.deleteMany({ where: { clientId } });
  const ids = orders.map((o) => o.orderId).filter((x): x is string => !!x);
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.storeProduct.deleteMany({ where: { sku: `B-${tag}` } });
  await prisma.$disconnect();
});

describe("tienda de insumos [P17]", () => {
  it("alta de producto con precio normal, oferta y stock", async () => {
    await expect(saveStoreProduct(prisma, null, { name: "Bolsas", price: 100, salePrice: 120, stock: 5, images: [], active: true })).rejects.toThrow(/oferta/);
    const p = await saveStoreProduct(prisma, null, { name: "Bolsas 28×40", price: 150, salePrice: 135, sku: `B-${tag}`, stock: 3, description: "Paquete de 100", images: [], active: true });
    expect(storePrice(p)).toBe(135);
    await expect(saveStoreProduct(prisma, null, { name: "Otra", price: 10, sku: `B-${tag}`, stock: 1, images: [], active: true })).rejects.toThrow(/SKU/);
    productId = p.id;
  });

  it("con saldo: se paga, descuenta stock y crea un pedido IN- asignable; al entregarlo queda entregado", async () => {
    await expect(placeStoreOrder(prisma, { clientId, userId, branchId, cart: [{ productId, qty: 2 }], pay: "saldo", baseUrl: "x" })).rejects.toThrow(/no alcanza/);
    await expect(placeStoreOrder(prisma, { clientId, userId, branchId, cart: [{ productId, qty: 4 }], pay: "saldo", baseUrl: "x" })).rejects.toThrow(/solo quedan 3/);
    await prisma.ledgerEntry.create({ data: { clientId, type: "PAYMENT", amount: new Prisma.Decimal(-300), description: "abono" } });
    const r = await placeStoreOrder(prisma, { clientId, userId, branchId, cart: [{ productId, qty: 2 }], pay: "saldo", baseUrl: "x" });
    const so = await prisma.storeOrder.findUniqueOrThrow({ where: { id: r.id }, include: { order: true } });
    expect(so.status).toBe("PAID");
    expect(Number(so.total)).toBe(270);
    expect(so.order).toMatchObject({ code: `IN-${String(so.number).padStart(5, "0")}`, source: "TIENDA", kind: "DELIVERY", status: "CREATED", branchId });
    expect(Number(await getClientBalance(prisma, clientId))).toBe(-30);
    expect((await prisma.storeProduct.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(1);
    // No genera cargo de envío.
    expect(await prisma.ledgerEntry.count({ where: { clientId, type: "CHARGE" } })).toBe(0);
    await adminMarkOrder(prisma, so.orderId!, { outcome: "delivered", note: "prueba", receiverName: "Ana" }, userId);
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("DELIVERED");
  });
});
