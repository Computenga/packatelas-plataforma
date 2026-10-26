// Recibos de nómina quincenales [A25, A26]: sueldo de 15 días, faltas y retardos del checador y
// adeudos del empleado (taller, etc.). RH revisa el borrador, lo aprueba (el empleado ya lo ve en su
// portal) y lo marca pagado con la referencia de la transferencia. No sustituye al CFDI timbrado.
import { Prisma, type PrismaClient, type PayrollLineKind } from "../generated/prisma/client.ts";
import { attendanceReport, quincenaOf } from "./attendance.ts";
import { audit } from "./orders.ts";
import { sendPush } from "./push.ts";

const D = (n: string | number | Prisma.Decimal) => new Prisma.Decimal(n);
export const PAY_DAYS = 15;

export function quincenaRange(key: string) {
  const m = key.match(/^(\d{4})-(\d{2})-([12])$/);
  if (!m) throw new Error("Quincena inválida");
  return quincenaOf(`${m[1]}-${m[2]}-${m[3] === "1" ? "01" : "16"}`);
}

export function receiptTotals(lines: { kind: PayrollLineKind; amount: string | number | Prisma.Decimal }[]) {
  const sum = (k: PayrollLineKind) => lines.filter((l) => l.kind === k).reduce((a, l) => a.plus(D(l.amount)), D(0));
  const perceptions = sum("PERCEPCION"), deductions = sum("DEDUCCION");
  return { perceptions, deductions, net: perceptions.minus(deductions) };
}

/**
 * Crea o recalcula los borradores de la quincena para los empleados activos con salario.
 * Los recibos aprobados o pagados no se tocan. Las líneas manuales del borrador se conservan.
 */
export async function generatePayroll(prisma: PrismaClient, key: string, actorUserId: string, now = new Date()) {
  const q = quincenaRange(key);
  const report = await attendanceReport(prisma, q.from, q.to, undefined, now);
  let created = 0, updated = 0, skipped = 0;
  for (const r of report) {
    const e = r.employee;
    if (e.dailySalary == null || Number(e.dailySalary) <= 0 || e.status !== "ACTIVO") { skipped++; continue; }
    await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollReceipt.findUnique({ where: { employeeId_quincena: { employeeId: e.id, quincena: key } } });
      if (existing && existing.status !== "BORRADOR") { skipped++; return; }
      const receipt = existing
        ? await tx.payrollReceipt.update({ where: { id: existing.id }, data: { dailySalary: e.dailySalary! } })
        : await tx.payrollReceipt.create({ data: { employeeId: e.id, quincena: key, periodFrom: new Date(`${q.from}T00:00:00Z`), periodTo: new Date(`${q.to}T00:00:00Z`), dailySalary: e.dailySalary! } });
      await tx.payrollLine.deleteMany({ where: { receiptId: receipt.id, auto: true } });
      const lines: Prisma.PayrollLineCreateManyInput[] = [
        { receiptId: receipt.id, kind: "PERCEPCION", concept: `Sueldo ${PAY_DAYS} días`, amount: D(e.dailySalary!).times(PAY_DAYS).toDecimalPlaces(2), auto: true, order: 0 },
      ];
      if (r.discount && r.discount > 0) {
        const parts = [r.absences ? `${r.absences} falta(s)` : "", r.lateMinutes + r.extraLunchMinutes ? `${r.lateMinutes + r.extraLunchMinutes} min de retardo/comida` : ""].filter(Boolean).join(", ");
        lines.push({ receiptId: receipt.id, kind: "DEDUCCION", concept: `Faltas y retardos (${parts})`, amount: D(r.discount), auto: true, order: 10 });
      }
      // Adeudos que aún no se han descontado en ningún recibo.
      const charges = await tx.employeeCharge.findMany({ where: { employeeId: e.id, payrollLine: null, createdAt: { lte: new Date(`${q.to}T23:59:59-06:00`) } }, orderBy: { createdAt: "asc" } });
      charges.forEach((c, i) => lines.push({ receiptId: receipt.id, kind: "DEDUCCION", concept: `Adeudo: ${c.description}`.slice(0, 160), amount: c.amount, auto: true, chargeId: c.id, order: 20 + i }));
      await tx.payrollLine.createMany({ data: lines });
      if (existing) updated++; else created++;
    });
  }
  await audit(prisma, { actorUserId, action: "payroll.generated", entity: "PayrollReceipt", entityId: key, summary: `Nómina ${key}: ${created} nuevos, ${updated} recalculados` });
  return { created, updated, skipped };
}

async function draft(prisma: PrismaClient, receiptId: string) {
  const r = await prisma.payrollReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  if (r.status !== "BORRADOR") throw new Error("Solo se puede editar un recibo en borrador");
  return r;
}

export async function addPayrollLine(prisma: PrismaClient, receiptId: string, line: { kind: PayrollLineKind; concept: string; amount: number }, actorUserId: string) {
  await draft(prisma, receiptId);
  if (!(line.amount > 0) || line.amount > 1_000_000) throw new Error("Monto inválido");
  if (line.concept.trim().length < 2) throw new Error("Escribe el concepto");
  const l = await prisma.payrollLine.create({ data: { receiptId, kind: line.kind, concept: line.concept.trim().slice(0, 160), amount: D(line.amount).toDecimalPlaces(2), order: 50 } });
  await audit(prisma, { actorUserId, action: "payroll.line_added", entity: "PayrollReceipt", entityId: receiptId, summary: `${line.kind === "PERCEPCION" ? "+" : "−"}${line.amount} ${line.concept}` });
  return l;
}

/** Quitar una línea. Un adeudo quitado pasa al siguiente recibo. */
export async function removePayrollLine(prisma: PrismaClient, lineId: string, actorUserId: string) {
  const l = await prisma.payrollLine.findUniqueOrThrow({ where: { id: lineId } });
  await draft(prisma, l.receiptId);
  if (l.auto && !l.chargeId) throw new Error("El sueldo y las faltas se recalculan solos; ajusta con una línea manual");
  await prisma.payrollLine.delete({ where: { id: lineId } });
  await audit(prisma, { actorUserId, action: "payroll.line_removed", entity: "PayrollReceipt", entityId: l.receiptId, summary: `Quitado: ${l.concept}` });
}

export async function setPayrollStatus(prisma: PrismaClient, receiptId: string, to: "BORRADOR" | "APROBADO" | "PAGADO", actorUserId: string, paymentRef?: string) {
  const r = await prisma.payrollReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { lines: true } });
  const allowed: Record<string, string[]> = { BORRADOR: ["APROBADO"], APROBADO: ["BORRADOR", "PAGADO"], PAGADO: ["APROBADO"] };
  if (!allowed[r.status].includes(to)) throw new Error("Cambio de estado no permitido");
  if (to === "APROBADO" && receiptTotals(r.lines).net.lt(0)) throw new Error("El neto no puede ser negativo; quita o reparte algún adeudo");
  await prisma.payrollReceipt.update({
    where: { id: receiptId },
    data: {
      status: to,
      ...(to === "APROBADO" && r.status === "BORRADOR" ? { approvedAt: new Date() } : {}),
      ...(to === "PAGADO" ? { paidAt: new Date(), paymentRef: paymentRef?.trim().slice(0, 80) || null } : {}),
      ...(r.status === "PAGADO" ? { paidAt: null, paymentRef: null } : {}),
    },
  });
  await audit(prisma, { actorUserId, action: "payroll.status", entity: "PayrollReceipt", entityId: receiptId, summary: `Recibo ${r.quincena}: ${r.status} → ${to}` });
  if (to !== "BORRADOR" && r.status !== "PAGADO") {
    const emp = await prisma.employee.findUnique({ where: { id: r.employeeId }, select: { userId: true } });
    if (emp?.userId) {
      const net = receiptTotals(r.lines).net.toFixed(2);
      void sendPush(prisma, [emp.userId], to === "PAGADO"
        ? { title: "Se pagó tu nómina", body: `Quincena ${r.quincena}: $${net}`, url: `/recibo/${r.id}`, tag: `nomina-${r.id}` }
        : { title: "Tu recibo de nómina está listo", body: `Quincena ${r.quincena}: $${net}`, url: `/recibo/${r.id}`, tag: `nomina-${r.id}` });
    }
  }
}
