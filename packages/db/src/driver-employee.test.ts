import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { driverDuplicateCases, ensureDriverEmployee, mergeDriverDuplicate, missingEmployeeData, nextEmployeeNo, prisma, reconcileAutoEmployees, sameName } from "./index.ts";

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
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
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

  it("corrige altas de más y resuelve la misma persona con dos usuarios", async () => {
    // Antes no ligaba un nombre de una palabra: ahora sí, si hay un único empleado activo así.
    const marlon = await prisma.employee.create({ data: { employeeNo: 882000 + Number(tag.slice(-3)), name: `Marlonx${tag} Antonio Ortiz` } });
    emps.push(marlon.id);
    const u = await mkDriver(`marlonx${tag}`);
    const auto = await prisma.employee.create({ data: { employeeNo: 883000 + Number(tag.slice(-3)), name: `marlonx${tag}`, userId: u, notes: "Alta automática al crear su usuario de repartidor. Falta registrar su huella en el checador." } });
    emps.push(auto.id);
    const fixed = await reconcileAutoEmployees(prisma);
    expect(fixed.some((f) => f.to === marlon.employeeNo)).toBe(true);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: marlon.id } })).userId).toBe(u);

    // Misma persona con dos usuarios: el empleado viejo ya tiene usuario.
    const old = await mkDriver(`Ariel Prueba${tag} Servin`);
    const oldEmp = await prisma.employee.create({ data: { employeeNo: 884000 + Number(tag.slice(-3)), name: `Ariel Prueba${tag} Servin`, userId: old } });
    emps.push(oldEmp.id);
    const dupUser = await mkDriver(`Ariel Prueba${tag} Servin`);
    const r = await ensureDriverEmployee(prisma, dupUser);
    expect(r?.status).toBe("created");
    const cases = (await driverDuplicateCases(prisma)).filter((c) => c.userId === dupUser);
    expect(cases[0].others[0].employeeNo).toBe(oldEmp.employeeNo);
    const admin = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" }, select: { id: true } })).id;
    await mergeDriverDuplicate(prisma, { autoId: cases[0].autoId, employeeId: oldEmp.id, keepUserId: dupUser }, admin);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: oldEmp.id } })).userId).toBe(dupUser);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: old } })).active).toBe(false);
  });
});
