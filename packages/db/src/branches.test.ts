import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, removeBranch, reactivateBranch } from "./index.ts";

const n = 800000 + Number(String(Date.now()).slice(-5));
let clientId: string, actor: string, acc: string;
const branch = (name: string) => prisma.branch.create({ data: { clientId, name, address: "Calle 1" } });

beforeAll(async () => {
  actor = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  clientId = (await prisma.client.create({ data: { publicId: `cmx${n}`, name: "Suc test", paymentReference: `CMX${n}`, tariffAmount: 50 } })).id;
});

afterAll(async () => {
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.pickup.deleteMany({ where: { clientId } });
  await prisma.branch.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("quitar sucursales", () => {
  it("no deja al cliente sin sucursal activa", async () => {
    const only = await branch("Única");
    expect(await removeBranch(prisma, only.id, actor)).toMatchObject({ ok: false, error: expect.stringMatching(/única/) });
    await prisma.branch.delete({ where: { id: only.id } });
  });

  it("borra la que no tiene movimientos y reacomoda la cuenta ML", async () => {
    const a = await branch("A");
    const b = await branch("B");
    acc = (await prisma.mlAccount.create({
      data: { mlUserId: BigInt(Date.now()) * 3n, nickname: "TEST_SUC", clientId, routes: { create: [{ branchId: a.id, isDefault: true }] } },
    })).id;
    await prisma.pickup.create({ data: { clientId, branchId: a.id, scheduledFor: new Date("2026-11-01T00:00:00Z"), status: "SCHEDULED" } });
    expect(await removeBranch(prisma, a.id, actor)).toEqual({ ok: true, mode: "deleted" });
    expect(await prisma.branch.findUnique({ where: { id: a.id } })).toBeNull();
    const routes = await prisma.mlAccountRoute.findMany({ where: { mlAccountId: acc } });
    expect(routes).toEqual([expect.objectContaining({ branchId: b.id, isDefault: true })]);
  });

  it("desactiva la que tiene historial y se puede reactivar", async () => {
    const c = await branch("C");
    await prisma.pickup.create({ data: { clientId, branchId: c.id, scheduledFor: new Date("2026-10-01T00:00:00Z"), status: "COLLECTED" } });
    await prisma.pickup.create({ data: { clientId, branchId: c.id, scheduledFor: new Date("2026-11-02T00:00:00Z"), status: "SCHEDULED" } });
    await prisma.branch.update({ where: { id: c.id }, data: { autoPickup: true, autoPickupDays: [1] } });
    expect(await removeBranch(prisma, c.id, actor)).toEqual({ ok: true, mode: "deactivated" });
    const after = await prisma.branch.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ active: false, autoPickup: false });
    expect(await prisma.pickup.count({ where: { branchId: c.id, status: "CANCELLED" } })).toBe(1);
    expect(await reactivateBranch(prisma, c.id, actor)).toMatchObject({ ok: true });
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: c.id } })).active).toBe(true);
  });
});
