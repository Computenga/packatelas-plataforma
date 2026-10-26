import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPayrollLine, generatePayroll, prisma, receiptTotals, removePayrollLine, setPayrollStatus } from "./index.ts";

const no = 700000 + Number(String(Date.now()).slice(-5));
let actor: string, empId: string;

beforeAll(async () => {
  actor = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  empId = (await prisma.employee.create({ data: { employeeNo: no, name: "Nómina Prueba", dailySalary: 300, workdays: [] } })).id;
  await prisma.employeeCharge.create({ data: { employeeId: empId, amount: 250, description: "Llanta", createdAt: new Date("2026-08-20T12:00:00Z") } });
});
afterAll(async () => {
  await prisma.payrollReceipt.deleteMany({ where: { employeeId: empId } });
  await prisma.employeeCharge.deleteMany({ where: { employeeId: empId } });
  await prisma.employee.delete({ where: { id: empId } });
  await prisma.$disconnect();
});

const receipt = (q: string) => prisma.payrollReceipt.findUniqueOrThrow({ where: { employeeId_quincena: { employeeId: empId, quincena: q } }, include: { lines: true } });

describe("nómina", () => {
  it("arma el borrador con sueldo y adeudos, conserva líneas manuales al recalcular", async () => {
    await generatePayroll(prisma, "2026-09-1", actor);
    let r = await receipt("2026-09-1");
    expect(receiptTotals(r.lines)).toMatchObject({ perceptions: expect.anything() });
    expect(Number(receiptTotals(r.lines).net)).toBe(4500 - 250);
    await addPayrollLine(prisma, r.id, { kind: "PERCEPCION", concept: "Bono puntualidad", amount: 200 }, actor);
    await generatePayroll(prisma, "2026-09-1", actor);
    r = await receipt("2026-09-1");
    expect(r.lines.map((l) => l.concept).sort()).toEqual(["Adeudo: Llanta", "Bono puntualidad", "Sueldo 15 días"]);
    expect(Number(receiptTotals(r.lines).net)).toBe(4450);
  });

  it("un adeudo se descuenta una sola vez; si se quita, pasa a la siguiente quincena", async () => {
    await generatePayroll(prisma, "2026-09-2", actor);
    expect((await receipt("2026-09-2")).lines.some((l) => l.chargeId)).toBe(false);
    const r1 = await receipt("2026-09-1");
    await removePayrollLine(prisma, r1.lines.find((l) => l.chargeId)!.id, actor);
    await generatePayroll(prisma, "2026-09-2", actor);
    expect((await receipt("2026-09-2")).lines.some((l) => l.concept === "Adeudo: Llanta")).toBe(true);
  });

  it("aprobado y pagado ya no se recalcula ni se edita", async () => {
    const r = await receipt("2026-09-1");
    await setPayrollStatus(prisma, r.id, "APROBADO", actor);
    await expect(addPayrollLine(prisma, r.id, { kind: "DEDUCCION", concept: "x", amount: 1 }, actor)).rejects.toThrow(/borrador/);
    await setPayrollStatus(prisma, r.id, "PAGADO", actor, "FON-123");
    expect(await receipt("2026-09-1")).toMatchObject({ status: "PAGADO", paymentRef: "FON-123" });
    await expect(setPayrollStatus(prisma, r.id, "BORRADOR", actor)).rejects.toThrow(/no permitido/);
  });
});
