import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, liveOrderIds, liveBucket, createManualOrder, addOrderEvent } from "./index.ts";

const tag = `lv${Date.now()}`;
let clientId: string;
const day = (ymd: string) => ({ from: new Date(`${ymd}T00:00:00-06:00`), to: new Date(`${ymd}T24:00:00-06:00`) });
const D = day("2026-10-20");
const at = (h: number) => new Date(`2026-10-20T${String(h).padStart(2, "0")}:00:00-06:00`);

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "Vivo", paymentReference: tag, tariffAmount: 0 } })).id;
});
afterAll(async () => {
  const ids = (await prisma.order.findMany({ where: { clientId }, select: { id: true } })).map((o) => o.id);
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

const order = async (extra: Record<string, unknown> = {}) => {
  const o = await createManualOrder(prisma, { clientId, recipientName: "X", addressLine: "Calle" });
  await prisma.order.update({ where: { id: o.id }, data: { createdAt: at(6), ...extra } });
  return o.id;
};

describe("En vivo del día", () => {
  it("incluye ML en camino o con cambio ese día, asignados, cargados y externos con compromiso ese día", async () => {
    const mlShipped = await order({ mlShipmentId: BigInt(Date.now()) * 10n + 1n, mlStatus: "shipped" });
    const mlDelivered = await order({ mlShipmentId: BigInt(Date.now()) * 10n + 2n, mlStatus: "delivered" });
    await addOrderEvent(prisma, { orderId: mlDelivered, type: "ml_status", source: "ML_SYNC", occurredAt: at(15), data: { status: "delivered", previous: "shipped" } });
    const mlOther = await order({ mlShipmentId: BigInt(Date.now()) * 10n + 3n, mlStatus: "ready_to_ship" });
    const assigned = await order();
    await addOrderEvent(prisma, { orderId: assigned, type: "assigned", source: "ADMIN", occurredAt: at(9) });
    const extToday = await order({ requestedDeliveryAt: at(12) });
    const extOtherDay = await order({ requestedDeliveryAt: new Date("2026-10-22T12:00:00-06:00") });

    const ids = new Set(await liveOrderIds(prisma, D.from, D.to));
    expect(ids.has(mlShipped)).toBe(true);
    expect(ids.has(mlDelivered)).toBe(true);
    expect(ids.has(assigned)).toBe(true);
    expect(ids.has(extToday)).toBe(true);
    expect(ids.has(mlOther)).toBe(false);
    expect(ids.has(extOtherDay)).toBe(false);
    expect(liveBucket({ status: "OUT_FOR_DELIVERY", mlStatus: "delivered" })).toBe("entregado");
    expect(liveBucket({ status: "FAILED", mlStatus: null })).toBe("fallido");
  });
});
