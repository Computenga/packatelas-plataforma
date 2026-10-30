import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClientUsers, importFlexLinks, importLegacyUsers, parseFlexLinks, parseLegacyUsers, prisma, verifyPassword } from "./index.ts";

const n = Math.floor(Math.random() * 1e6);
const U = (s: string) => `zt${n}_${s}`;
let adminId = "", clientId = "";
const created: string[] = [];

beforeAll(async () => {
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  clientId = (await prisma.client.create({ data: { publicId: `cmx9${n}`, name: "Cliente migración", paymentReference: `MIG${n}`, tariffAmount: 0, email: `mig${n}@ejemplo.mx` } })).id;
});
afterAll(async () => {
  const users = await prisma.user.findMany({ where: { OR: [{ username: { startsWith: `zt${n}_` } }, { clientId }] }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.flexIdentity.deleteMany({ where: { driver: { userId: { in: ids } } } });
  await prisma.driver.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("migración", () => {
  it("lee usuarios y crea con contraseña temporal obligatoria; repartidor con carrier; no duplica", async () => {
    const txt = `${U("ana")}|A|||1;${U("pepe")}|R|Pepe Flex|9${n}|1\n${U("old")}|R||8${n}|0;mal renglon`;
    const { rows, errors } = parseLegacyUsers(txt);
    expect(rows).toHaveLength(3);
    expect(errors).toHaveLength(1);
    expect(rows[0].name).toBe(`Zt${n} Ana`);
    await expect(importLegacyUsers(prisma, rows, "corta", adminId)).rejects.toThrow(/8\+/);
    const r = await importLegacyUsers(prisma, rows, "Temporal2026", adminId);
    expect(r.created).toHaveLength(3);
    const pepe = await prisma.user.findUniqueOrThrow({ where: { username: U("pepe") }, include: { driver: true } });
    expect(pepe).toMatchObject({ role: "REPARTIDOR", mustChangePassword: true, active: true });
    expect(pepe.driver?.legacyCarrierId).toBe(Number(`9${n}`));
    expect(await verifyPassword("Temporal2026", pepe.passwordHash)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: U("old") } })).active).toBe(false);
    const again = await importLegacyUsers(prisma, rows, "Temporal2026", adminId);
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toHaveLength(3);
  });

  it("vincula drivers Flex sin pisar los que ya están", async () => {
    const pepe = await prisma.user.findUniqueOrThrow({ where: { username: U("pepe") }, include: { driver: true } });
    const old = await prisma.user.findUniqueOrThrow({ where: { username: U("old") }, include: { driver: true } });
    await prisma.flexIdentity.create({ data: { flexDriverId: BigInt(`77${n}`), driverId: old.driver!.id } });
    const rows = parseFlexLinks(`flex,usuario,envio\n66${n},${U("pepe")},48306220006\n77${n},${U("pepe")},\n55${n},nadie,`);
    const r = await importFlexLinks(prisma, rows, adminId);
    expect(r.linked).toHaveLength(1);
    expect(r.kept).toHaveLength(1);
    expect(r.missing).toHaveLength(1);
    expect((await prisma.flexIdentity.findUniqueOrThrow({ where: { flexDriverId: BigInt(`77${n}`) } })).driverId).toBe(old.driver!.id);
    expect((await prisma.flexIdentity.findUniqueOrThrow({ where: { flexDriverId: BigInt(`66${n}`) } })).driverId).toBe(pepe.driver!.id);
  });

  it("crea un usuario por cliente sin usuario, con su ID como usuario", async () => {
    const r = await createClientUsers(prisma, "Temporal2026", adminId);
    const mine = await prisma.user.findFirstOrThrow({ where: { clientId } });
    expect(mine).toMatchObject({ username: `cmx9${n}`, role: "CLIENTE", mustChangePassword: true, email: `mig${n}@ejemplo.mx` });
    expect(r.created.some((c) => c.username === `cmx9${n}`)).toBe(true);
    expect((await createClientUsers(prisma, "Temporal2026", adminId)).created.some((c) => c.username === `cmx9${n}`)).toBe(false);
  });
});
