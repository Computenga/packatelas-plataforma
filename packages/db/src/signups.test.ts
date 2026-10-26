import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, submitSignup, approveSignup, rejectSignup, verifyPassword } from "./index.ts";

const tag = `su${Date.now()}`;
const base = {
  businessName: "Tienda Registro", contactName: "Ana Registro", phone: `55${String(Date.now()).slice(-8)}`,
  email: `${tag}@ejemplo.com`, zone: "emx" as const, pickupAddress: "Av. Central 100, Ecatepec", pickupReference: "Portón negro",
  username: tag, password: "secreta123",
};

afterAll(async () => {
  const s = await prisma.clientSignup.findMany({ where: { email: { startsWith: tag } } });
  const cids = s.map((x) => x.clientId).filter((x): x is string => !!x);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...cids, ...s.map((x) => x.id)] } } });
  await prisma.user.deleteMany({ where: { clientId: { in: cids } } });
  await prisma.branch.deleteMany({ where: { clientId: { in: cids } } });
  await prisma.clientSignup.deleteMany({ where: { email: { startsWith: tag } } });
  await prisma.client.deleteMany({ where: { id: { in: cids } } });
  await prisma.$disconnect();
});

describe("registro de clientes", () => {
  it("solicitud → aprobación crea cliente emx, sucursal y usuario que puede entrar", async () => {
    const r = await submitSignup(prisma, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await submitSignup(prisma, { ...base, username: `${tag}b` })).toMatchObject({ ok: false }); // misma solicitud pendiente

    const [a, b] = await Promise.all([
      approveSignup(prisma, { signupId: r.id, tariffAmount: 115 }),
      approveSignup(prisma, { signupId: r.id, tariffAmount: 115 }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const ok = a.ok ? a : b;
    if (!ok.ok) return;
    expect(ok.publicId).toMatch(/^emx\d{5}$/);
    const c = await prisma.client.findUniqueOrThrow({ where: { id: ok.clientId }, include: { branches: true, users: true } });
    expect(c.paymentReference).toBe(ok.publicId.toUpperCase());
    expect(c.branches[0].address).toContain("Portón negro");
    expect(c.users[0]).toMatchObject({ username: tag, role: "CLIENTE" });
    expect(await verifyPassword("secreta123", c.users[0].passwordHash)).toBe(true);
    // El usuario ya existe: no se puede volver a registrar con él
    expect(await submitSignup(prisma, { ...base, email: `${tag}x@ejemplo.com`, phone: "5500000000" })).toMatchObject({ ok: false, error: expect.stringMatching(/usuario/) });
  });

  it("rechazar solo una vez", async () => {
    const r = await submitSignup(prisma, { ...base, username: `${tag}r`, email: `${tag}r@ejemplo.com`, phone: "5511110000" });
    if (!r.ok) throw new Error(r.error);
    expect(await rejectSignup(prisma, r.id, "Fuera de cobertura")).toBe(true);
    expect(await rejectSignup(prisma, r.id, "otra vez")).toBe(false);
    expect(await approveSignup(prisma, { signupId: r.id, tariffAmount: 115 })).toMatchObject({ ok: false });
  });
});
