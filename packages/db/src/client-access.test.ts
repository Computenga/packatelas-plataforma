import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { completeFirstAccess, hashPassword, passwordResetFor, prisma, resetPassword, startFirstAccess, verifyPassword } from "./index.ts";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const tag = String(Date.now()).slice(-6);
const publicId = `cmx9${tag}`;
let clientId = "";
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { summary: { contains: publicId } } });
  await prisma.session.deleteMany({ where: { user: { clientId } } });
  await prisma.user.deleteMany({ where: { clientId } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("acceso de clientes", () => {
  it("primer acceso con número de cliente y últimos 4 del WhatsApp; luego restablecer por correo", async () => {
    const c = await prisma.client.create({ data: { publicId, name: `Cliente ${tag}`, phone: "55 1234 9876", paymentReference: `REF${tag}` } });
    clientId = c.id;
    await prisma.user.create({ data: { username: publicId, name: c.name, role: "CLIENTE", clientId, passwordHash: await hashPassword("Temporal-123"), mustChangePassword: true } });

    expect((await startFirstAccess(prisma, publicId.toUpperCase(), "1111")).status).toBe("invalid");
    expect((await startFirstAccess(prisma, "cmx00000", "9876")).status).toBe("invalid");
    const s = await startFirstAccess(prisma, ` ${publicId.toUpperCase()} `, "9876");
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    expect((await completeFirstAccess(prisma, s.token, "corta", "a@b.com")).ok).toBe(false);
    expect((await completeFirstAccess(prisma, s.token, "MiClave2026", "no-es-correo")).ok).toBe(false);
    const done = await completeFirstAccess(prisma, s.token, "MiClave2026", `Cliente${tag}@Example.com`);
    expect(done.ok).toBe(true);
    // El mismo enlace ya no sirve, y el primer acceso ya no aplica.
    expect((await completeFirstAccess(prisma, s.token, "OtraClave2026", "x@y.com")).ok).toBe(false);
    expect((await startFirstAccess(prisma, publicId, "9876")).status).toBe("already");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).email).toBe(`cliente${tag}@example.com`);

    const r = await passwordResetFor(prisma, publicId);
    expect(r?.email).toBe(`cliente${tag}@example.com`);
    expect((await passwordResetFor(prisma, `cliente${tag}@example.com`))?.user.id).toBe(r!.user.id);
    expect((await resetPassword(prisma, r!.token!, "NuevaClave77")).ok).toBe(true);
    expect((await resetPassword(prisma, r!.token!, "OtraMas88")).ok).toBe(false); // ya se usó
    const u = await prisma.user.findUniqueOrThrow({ where: { username: publicId } });
    expect(await verifyPassword("NuevaClave77", u.passwordHash)).toBe(true);
  });
});
