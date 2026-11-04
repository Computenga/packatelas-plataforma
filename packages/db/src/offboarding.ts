// Baja de personal en un paso: estatus, fecha y motivo; quita el acceso al portal (y cierra sus
// sesiones); avisa qué queda pendiente (paquetes en su poder, adeudos sin descontar) para el finiquito.
// Reingreso: lo contrario, conservando su historial.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

export const BAJA_REASONS = ["Renuncia voluntaria", "Rescisión (despido justificado)", "Despido", "Abandono de trabajo", "Fin de contrato", "Otro"] as const;

export async function offboardingSummary(prisma: PrismaClient, employeeId: string) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { user: { include: { driver: { select: { id: true } } } } } });
  const driverId = e.user?.driver?.id;
  const [packages, charges] = await Promise.all([
    driverId ? prisma.order.count({ where: { driverId, status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY", "FAILED", "RETURNING"] } } }) : 0,
    prisma.employeeCharge.aggregate({ where: { employeeId, payrollLine: null }, _sum: { amount: true }, _count: true }),
  ]);
  return { packages, pendingCharges: Number(charges._sum.amount ?? 0), pendingChargesCount: charges._count };
}

export async function offboardEmployee(prisma: PrismaClient, input: { employeeId: string; date: string; reason: string; note?: string }, actorUserId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Fecha de baja inválida");
  if (!(BAJA_REASONS as readonly string[]).includes(input.reason)) throw new Error("Elige el motivo de la baja");
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
  if (e.status === "BAJA") throw new Error("Ya está dado de baja");
  const line = `Baja ${input.date}: ${input.reason}${input.note?.trim() ? ` — ${input.note.trim().slice(0, 300)}` : ""}`;
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: e.id }, data: { status: "BAJA", endDate: new Date(`${input.date}T00:00:00Z`), notes: [e.notes, line].filter(Boolean).join("\n").slice(0, 4000) } });
    if (e.userId) {
      await tx.user.update({ where: { id: e.userId }, data: { active: false } });
      await tx.session.deleteMany({ where: { userId: e.userId } });
    }
  });
  await audit(prisma, { actorUserId, action: "employee.offboarded", entity: "Employee", entityId: e.id, summary: `${e.name} (#${e.employeeNo}) dado de baja: ${input.reason}` });
  return offboardingSummary(prisma, e.id);
}

export async function rehireEmployee(prisma: PrismaClient, employeeId: string, date: string, actorUserId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Fecha de reingreso inválida");
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (e.status === "ACTIVO") throw new Error("Ya está activo");
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: e.id }, data: { status: "ACTIVO", endDate: null, hireDate: new Date(`${date}T00:00:00Z`), notes: [e.notes, `Reingreso ${date}${e.hireDate ? ` (ingreso anterior ${e.hireDate.toISOString().slice(0, 10)})` : ""}`].filter(Boolean).join("\n").slice(0, 4000) } });
    if (e.userId) await tx.user.update({ where: { id: e.userId }, data: { active: true } });
  });
  await audit(prisma, { actorUserId, action: "employee.rehired", entity: "Employee", entityId: e.id, summary: `Reingreso de ${e.name} (#${e.employeeNo})` });
}
