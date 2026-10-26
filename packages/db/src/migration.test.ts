import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, importClients, normalizePublicId, getClientBalance, OPENING_BALANCE_TAG } from "./index.ts";

const n = Number(String(Date.now()).slice(-5)) + 900000; // número alto, no choca con reales
const id = (suffix = "") => `cmx${n}${suffix}`;

afterAll(async () => {
  const cs = await prisma.client.findMany({ where: { publicId: { startsWith: `cmx${n}` } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await prisma.ledgerEntry.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.branch.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { action: "clients.imported", entityId: { startsWith: `t${n}` } } });
  await prisma.$disconnect();
});

describe("normalizePublicId", () => {
  it("acepta variantes del ID y rechaza basura", () => {
    expect(normalizePublicId("CMX114")).toBe("cmx00114");
    expect(normalizePublicId(" cmx 00127-Granjas ")).toBe("cmx00127-granjas");
    expect(normalizePublicId("cmx-5")).toBe("cmx00005");
    expect(normalizePublicId("EMX 141")).toBe("emx00141");
    expect(normalizePublicId("xmx00141")).toBeNull();
    expect(normalizePublicId("cliente 3")).toBeNull();
  });
});

describe("importClients", () => {
  it("crea con sucursal y saldo inicial; reimportar actualiza sin duplicar saldo", async () => {
    const rows = [
      { publicId: id(), name: "Tienda Migrada", phone: "5511112222", tariffAmount: 75, pickupAddress: "Calle Uno 1", openingBalance: 1500 },
      { publicId: id("-norte"), name: "Tienda Migrada Norte", openingBalance: -200 },
    ];
    const [a, b] = await Promise.all([
      importClients(prisma, { batchId: `t${n}-1`, rows }),
      importClients(prisma, { batchId: `t${n}-1`, rows }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["already", "done"]);
    expect(a.created).toEqual([id(), id("-norte")]);

    const c = await prisma.client.findUniqueOrThrow({ where: { publicId: id() }, include: { branches: true } });
    expect(c.paymentReference).toBe(`CMX${n}`);
    expect(c.tariffAmount.toString()).toBe("75");
    expect(c.branches[0]?.address).toBe("Calle Uno 1");
    expect((await getClientBalance(prisma, c.id)).toString()).toBe("1500");
    const sub = await prisma.client.findUniqueOrThrow({ where: { publicId: id("-norte") } });
    expect(sub.paymentReference).toBe(`CMX${n}NORTE`);
    expect((await getClientBalance(prisma, sub.id)).toString()).toBe("-200");

    // Segunda carga (otro lote): actualiza el teléfono, conserva la tarifa y no repite saldo
    const r = await importClients(prisma, { batchId: `t${n}-2`, rows: [{ publicId: id(), name: "Tienda Migrada SA", phone: "5599998888", openingBalance: 1500 }] });
    expect(r).toMatchObject({ updated: [id()], created: [], balances: 0, balanceSkipped: [id()] });
    const c2 = await prisma.client.findUniqueOrThrow({ where: { id: c.id } });
    expect(c2).toMatchObject({ name: "Tienda Migrada SA", phone: "5599998888" });
    expect(c2.tariffAmount.toString()).toBe("75");
    expect(await prisma.ledgerEntry.count({ where: { clientId: c.id, description: OPENING_BALANCE_TAG } })).toBe(1);
  });

  it("rechaza IDs repetidos o inválidos sin crear nada", async () => {
    await expect(importClients(prisma, { batchId: `t${n}-3`, rows: [{ publicId: id("-x"), name: "A" }, { publicId: id("-x"), name: "B" }] })).rejects.toThrow(/repetido/);
    expect(await prisma.client.count({ where: { publicId: id("-x") } })).toBe(0);
  });
});
