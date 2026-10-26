import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client.ts";
import { prisma, lastCutoff, decideState, agingFromEntries, accountState, isPickupBlocked } from "./index.ts";

const iso = (d: Date) => d.toISOString();

describe("día de corte", () => {
  it("lunes 00:00 hora CDMX; el propio lunes cuenta desde esa medianoche", () => {
    // Domingo 25 oct 2026, 20:00 CDMX → corte: lunes 19 oct 00:00
    expect(iso(lastCutoff(new Date("2026-10-25T20:00:00-06:00"), 1))).toBe("2026-10-19T06:00:00.000Z");
    // Lunes 26 oct 00:30 CDMX → corte: ese mismo lunes
    expect(iso(lastCutoff(new Date("2026-10-26T00:30:00-06:00"), 1))).toBe("2026-10-26T06:00:00.000Z");
    // Domingo 23:59 CDMX (ya lunes en UTC) sigue en la semana anterior
    expect(iso(lastCutoff(new Date("2026-10-25T23:59:00-06:00"), 1))).toBe("2026-10-19T06:00:00.000Z");
    // Corte en viernes (5)
    expect(iso(lastCutoff(new Date("2026-10-28T12:00:00-06:00"), 5))).toBe("2026-10-23T06:00:00.000Z");
  });
});

describe("decisión de bloqueo", () => {
  const now = new Date("2026-10-28T12:00:00-06:00");
  const base = { id: "c", creditLimit: null, pickupExemptUntil: null };
  it("prepago: cualquier adeudo bloquea; con límite, al rebasarlo", () => {
    expect(decideState({ ...base, creditMode: "PREPAID" }, 115, 115, now).blocked).toBe(true);
    expect(decideState({ ...base, creditMode: "PREPAID" }, 0, 0, now).blocked).toBe(false);
    expect(decideState({ ...base, creditMode: "PREPAID", creditLimit: new Prisma.Decimal(500) }, 400, 400, now).blocked).toBe(false);
  });
  it("crédito semanal: solo lo anterior al corte bloquea; límite opcional a media semana", () => {
    expect(decideState({ ...base, creditMode: "WEEKLY_CREDIT" }, 9000, 0, now)).toMatchObject({ blocked: false });
    expect(decideState({ ...base, creditMode: "WEEKLY_CREDIT" }, 9000, 115, now)).toMatchObject({ blocked: true, reason: expect.stringMatching(/anterior/) });
    expect(decideState({ ...base, creditMode: "WEEKLY_CREDIT", creditLimit: new Prisma.Decimal(5000) }, 9000, 0, now)).toMatchObject({ blocked: true });
  });
  it("la exención manda", () => {
    expect(decideState({ ...base, creditMode: "PREPAID", pickupExemptUntil: new Date("2026-12-31") }, 900, 900, now)).toMatchObject({ blocked: false, exempt: true });
  });
});

describe("antigüedad de saldos", () => {
  it("aplica abonos a lo más viejo y clasifica el resto", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const d = (days: number) => new Date(now.getTime() - days * 86400_000);
    const r = agingFromEntries([
      { amount: 100, createdAt: d(40) },
      { amount: 100, createdAt: d(20) },
      { amount: 100, createdAt: d(10) },
      { amount: 100, createdAt: d(2) },
      { amount: -150, createdAt: d(1) },
    ], now);
    expect(r.buckets).toEqual({ d0_7: 100, d8_15: 100, d16_30: 50, d30: 0 });
    expect(r.total).toBe(250);
    expect(r.oldest).toEqual(d(20));
  });
});

describe("crédito semanal con el libro real", () => {
  const tag = `cr${Date.now()}`;
  let clientId = "";
  afterAll(async () => {
    if (clientId) {
      await prisma.ledgerEntry.deleteMany({ where: { clientId } });
      await prisma.client.delete({ where: { id: clientId } });
    }
    await prisma.$disconnect();
  });
  it("el lunes amanece bloqueado por lo de la semana pasada y se libera al liquidarlo", async () => {
    const c = await prisma.client.create({ data: { publicId: tag, name: "Crédito", paymentReference: tag, tariffAmount: 100, creditMode: "WEEKLY_CREDIT" } });
    clientId = c.id;
    const sunday = new Date("2026-10-25T18:00:00-06:00");
    const tuesday = new Date("2026-10-27T10:00:00-06:00");
    await prisma.ledgerEntry.createMany({ data: [
      { clientId, type: "CHARGE", amount: 300, description: "semana pasada", createdAt: new Date("2026-10-22T10:00:00-06:00") },
      { clientId, type: "CHARGE", amount: 200, description: "esta semana", createdAt: new Date("2026-10-26T10:00:00-06:00") },
    ] });
    expect(await isPickupBlocked(prisma, clientId, sunday)).toBe(false); // domingo: aún en su semana
    expect(await accountState(prisma, clientId, tuesday)).toMatchObject({ blocked: true, overdue: 300 });
    await prisma.ledgerEntry.create({ data: { clientId, type: "PAYMENT", amount: -300, description: "pago", createdAt: tuesday } });
    expect(await accountState(prisma, clientId, tuesday)).toMatchObject({ blocked: false, balance: 200, overdue: 0 });
  });
});
