import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, Prisma, fulfillGuestShipment, getClientBalance, guestClient, guestStatus } from "./index.ts";

const ids: { guest?: string; checkout?: string; order?: string } = {};

afterAll(async () => {
  if (ids.guest) {
    const g = await prisma.guestShipment.findUnique({ where: { id: ids.guest } });
    await prisma.guestShipment.delete({ where: { id: ids.guest } });
    if (g?.orderId) { await prisma.ledgerEntry.deleteMany({ where: { orderId: g.orderId } }); await prisma.order.delete({ where: { id: g.orderId } }); }
    if (g?.pickupId) { const p = await prisma.pickup.findUnique({ where: { id: g.pickupId } }); await prisma.order.deleteMany({ where: { pickupId: g.pickupId } }); await prisma.pickup.delete({ where: { id: g.pickupId } }); if (p) await prisma.branch.delete({ where: { id: p.branchId } }).catch(() => {}); }
  }
  if (ids.checkout) { await prisma.ledgerEntry.deleteMany({ where: { description: "test-guest" } }); await prisma.mpCheckout.delete({ where: { id: ids.checkout } }); }
  await prisma.$disconnect();
});

describe("envío sin registro [P14]", () => {
  it("al pagarse crea recolección y envío una sola vez, y el saldo queda en cero", async () => {
    const c = await guestClient(prisma);
    expect(Number(c.tariffAmount)).toBe(250);
    const before = Number(await getClientBalance(prisma, c.id));
    const ck = await prisma.mpCheckout.create({ data: { clientId: c.id, amount: 250, fee: 0, total: 250, status: "APPROVED" } });
    ids.checkout = ck.id;
    await prisma.ledgerEntry.create({ data: { clientId: c.id, type: "PAYMENT", amount: new Prisma.Decimal(-250), description: "test-guest" } });
    const g = await prisma.guestShipment.create({
      data: {
        token: "tok_" + "x".repeat(20) + Date.now(), checkoutId: ck.id, price: 250, senderName: "Ana", senderPhone: "5511112222", senderEmail: "a@b.mx",
        pickupAddress: "Calle 1, Col. Centro", pickupDate: new Date("2026-11-03T00:00:00Z"), recipientName: "Beto", recipientPhone: "5533334444",
        addressLine: "Av. 2 #3", city: "Coyoacán", zip: "04000", contents: "Caja de ropa",
      },
    });
    ids.guest = g.id;
    const o = await fulfillGuestShipment(prisma, ck.id);
    expect(o?.code).toMatch(/^PK-/);
    expect(await fulfillGuestShipment(prisma, ck.id)).toBeNull();
    const after = await prisma.guestShipment.findUniqueOrThrow({ where: { id: g.id } });
    expect(after.status).toBe("PAID");
    expect(after.pickupId).toBeTruthy();
    expect(Number(await getClientBalance(prisma, c.id))).toBe(before);
    expect((await guestStatus(prisma, g.token))?.order?.code).toBe(o?.code);
  });
});
