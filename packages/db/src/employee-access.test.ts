import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { completeEmployeeAccess, prisma, startEmployeeAccess } from "./index.ts";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const NO = 9911, NO2 = 9912;
afterAll(async () => {
  const emps = await prisma.employee.findMany({ where: { employeeNo: { in: [NO, NO2] } } });
  await prisma.employee.deleteMany({ where: { employeeNo: { in: [NO, NO2] } } });
  const ids = emps.map((e) => e.userId).filter((x): x is string => !!x);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.driver.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("primer acceso de empleados", () => {
  it("valida RFC + número, crea su usuario (RFC) y no deja activarlo dos veces", async () => {
    await prisma.employee.create({ data: { employeeNo: NO, name: "Repa Prueba", rfc: "xaxx010101aa1", kind: "repartidor", phone: "5511112222" } });
    await prisma.employee.create({ data: { employeeNo: NO2, name: "Baja Prueba", rfc: "XEXX010101AA2", status: "BAJA" } });
    expect((await startEmployeeAccess(prisma, "XAXX010101AA1", String(NO2))).status).toBe("invalid");
    expect((await startEmployeeAccess(prisma, "XEXX010101AA2", String(NO2))).status).toBe("invalid");
    const s = await startEmployeeAccess(prisma, " xaxx-010101-aa1 ", String(NO));
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    expect((await completeEmployeeAccess(prisma, s.token, "corta", "")).ok).toBe(false);
    const r = await completeEmployeeAccess(prisma, s.token, "Packatelas1", "");
    expect(r).toMatchObject({ ok: true, username: "xaxx010101aa1", role: "REPARTIDOR" });
    const u = await prisma.user.findUniqueOrThrow({ where: { username: "xaxx010101aa1" }, include: { driver: true, employee: true } });
    expect(u.driver?.phone).toBe("5511112222");
    expect(u.employee?.employeeNo).toBe(NO);
    expect((await completeEmployeeAccess(prisma, s.token, "Packatelas1", "")).ok).toBe(false);
    expect(await startEmployeeAccess(prisma, "XAXX010101AA1", String(NO))).toEqual({ status: "already", username: "xaxx010101aa1" });
  });
});
