"use server";

import { revalidatePath } from "next/cache";
import { addPayrollLine, generatePayroll, prisma, removePayrollLine, setPayrollStatus } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const fail = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message : "No se pudo guardar" });

export async function generateAction(key: string): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const r = await generatePayroll(prisma, key, user.id);
    revalidatePath("/admin/nomina");
    return { ok: `${r.created} recibo(s) nuevos, ${r.updated} recalculados${r.skipped ? `, ${r.skipped} sin cambio (aprobados, pagados o sin salario)` : ""}` };
  } catch (e) { return fail(e); }
}

export async function addLineAction(receiptId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const kind = fd.get("kind") === "PERCEPCION" ? "PERCEPCION" : "DEDUCCION";
    await addPayrollLine(prisma, receiptId, { kind, concept: String(fd.get("concept") ?? ""), amount: Number(fd.get("amount")) }, user.id);
    revalidatePath(`/admin/nomina/${receiptId}`);
    return { ok: "Línea agregada" };
  } catch (e) { return fail(e); }
}

export async function removeLineAction(receiptId: string, lineId: string): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    await removePayrollLine(prisma, lineId, user.id);
    revalidatePath(`/admin/nomina/${receiptId}`);
    return { ok: "Línea quitada" };
  } catch (e) { return fail(e); }
}

export async function statusAction(receiptId: string, to: "BORRADOR" | "APROBADO" | "PAGADO", _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    await setPayrollStatus(prisma, receiptId, to, user.id, String(fd.get("paymentRef") ?? ""));
    revalidatePath(`/admin/nomina/${receiptId}`);
    revalidatePath("/admin/nomina");
    return { ok: to === "PAGADO" ? "Marcado como pagado" : to === "APROBADO" ? "Aprobado: el empleado ya lo ve en su portal" : "Regresó a borrador" };
  } catch (e) { return fail(e); }
}

/** Aprueba todos los borradores de la quincena con neto no negativo. */
export async function approveAllAction(key: string): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const drafts = await prisma.payrollReceipt.findMany({ where: { quincena: key, status: "BORRADOR" }, select: { id: true } });
  let ok = 0; const bad: string[] = [];
  for (const d of drafts) {
    try { await setPayrollStatus(prisma, d.id, "APROBADO", user.id); ok++; } catch (e) { bad.push(e instanceof Error ? e.message : "error"); }
  }
  revalidatePath("/admin/nomina");
  return bad.length ? { error: `${ok} aprobados; ${bad.length} con problema: ${bad[0]}` } : { ok: `${ok} recibo(s) aprobados` };
}
