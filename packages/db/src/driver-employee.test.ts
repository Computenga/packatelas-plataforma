import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { ensureDriverEmployee, missingEmployeeData, nextEmployeeNo, prisma, sameName } from "./index.ts";

const tag = String(Date.now()).slice(-7);
const users: string[] = [];
const emps: string[] = [];
const mkDriver = async (name: string, phone?: string) => {
  const u = await prisma.user.create({ data: { username: `rep${tag}${users.length}`, name, role: "REPARTIDOR", passwordHash: "x", driver: { create: { phone } } } });
  users.push(u.id);
  return u.id;
};

afterAll(async () => {
  await prisma.employee.deleteMany({ where: { OR: [{ userId: { in: users } }, { id: { in: emps } }] } });
  await prisma.driver.deleteMany({ where: { userId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: null, action: { in: ["employee.linked_driver", "employee.created_for_driver"] }, summary: { contains: tag } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("repartidor → empleado", () => {
  it("compara nombres sin acentos ni orden", () => {
    expect(sameName("José Isaías Javier", "jose isaias javier lopez")).toBe(true);
    expect(sameName("Javier Jose", "José Javier")).toBe(true);
    expect(sameName("José", "José Pérez")).toBe(false);
    expect(sameName("Ana López", "Ana Pérez")).toBe(false);
  });

  it("vincula por teléfono o nombre y si no, crea el empleado con el siguiente consecutivo", async () => {
    const byPhone = await prisma.employee.create({ data: { employeeNo: 880000 + Number(tag.slice(-3)), name: `Otro Nombre ${tag}`, phone: `55${tag}01`.slice(0, 10) } });
    const byName = await prisma.employee.create({ data: { employeeNo: 881000 + Number(tag.slice(-3)), name: `Zacarías Prueba${tag} Ruiz` } });
    emps.push(byPhone.id, byName.id);

    const a = await mkDriver(`Repartidor ${tag}`, `+52 1 ${`55${tag}01`.slice(0, 10)}`);
    expect(await ensureDriverEmployee(prisma, a)).toMatchObject({ status: "linked", by: "teléfono", employeeNo: byPhone.employeeNo });

    const b = await mkDriver(`zacarias prueba${tag}`);
    expect(await ensureDriverEmployee(prisma, b)).toMatchObject({ status: "linked", by: "nombre", employeeNo: byName.employeeNo });

    const expected = await nextEmployeeNo(prisma);
    expect(expected).toBeLessThan(100_000); // los números de prueba altos no cuentan
    const c = await mkDriver(`Nuevo Repartidor ${tag}`, "5599990000");
    const r = await ensureDriverEmployee(prisma, c);
    expect(r).toMatchObject({ status: "created", employeeNo: expected });
    const e = await prisma.employee.findUniqueOrThrow({ where: { userId: c } });
    expect(e).toMatchObject({ kind: "repartidor", phone: "5599990000", status: "ACTIVO" });
    expect(missingEmployeeData(e)).toContain("CURP");
    expect(await ensureDriverEmployee(prisma, c)).toMatchObject({ status: "exists" });
    expect(await nextEmployeeNo(prisma)).toBe(expected + 1);
  });
});
