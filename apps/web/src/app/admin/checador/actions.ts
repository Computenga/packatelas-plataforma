"use server";

import { revalidatePath } from "next/cache";
import { addJustification, audit, forgetAdmsDevice, prisma, setAdmsConfig } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function justifyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const date = String(fd.get("date") ?? "");
  const to = String(fd.get("to") ?? "") || date;
  const reason = String(fd.get("reason") ?? "").trim();
  const employeeId = String(fd.get("employeeId") ?? "") || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < date) return { error: "Fechas inválidas" };
  if (reason.length < 3) return { error: "Escribe el motivo (vacaciones, incapacidad, festivo…)" };
  let n = 0;
  for (let t = new Date(`${date}T12:00:00Z`); t.toISOString().slice(0, 10) <= to && n < 62; t = new Date(t.getTime() + 86400_000), n++) {
    await addJustification(prisma, { date: t.toISOString().slice(0, 10), employeeId, reason, note: String(fd.get("note") ?? "") }, user.id);
  }
  revalidatePath("/admin/checador");
  return { ok: `${n} día(s) justificados` };
}

export async function removeJustification(id: string) {
  const user = await requireUser(["ADMIN"]);
  const j = await prisma.justification.delete({ where: { id } });
  await audit(prisma, { actorUserId: user.id, action: "attendance.unjustified", entity: "Justification", entityId: id, summary: `Se quitó la justificación del ${j.date.toISOString().slice(0, 10)}` });
  revalidatePath("/admin/checador");
}

/** Recepción directa del ZKTeco (ADMS) [A23]: activar y registrar números de serie. */
export async function admsConfigAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const enabled = fd.get("enabled") === "on";
  const serials = String(fd.get("serials") ?? "").split(/[\s,;]+/);
  const ips = String(fd.get("ips") ?? "").split(/[\s,;]+/);
  if (enabled && !serials.some((s) => s.trim())) return { error: "Agrega el número de serie del reloj para activarlo" };
  if (enabled && !ips.some((s) => s.trim())) return { error: "Agrega la IP pública de la oficina (aparece junto al reloj en la lista)" };
  const c = await setAdmsConfig(prisma, enabled, serials, ips);
  await audit(prisma, { actorUserId: user.id, action: "checador.adms_config", entity: "Setting", summary: `Recepción ZKTeco ${enabled ? "activada" : "apagada"} (${c.serials.join(", ") || "sin relojes"}; IP ${c.ips.join(", ") || "—"})` });
  revalidatePath("/admin/checador");
  return { ok: enabled ? "Recepción activada" : "Guardado (apagada)" };
}

export async function forgetDeviceAction(sn: string) {
  await requireUser(["ADMIN"]);
  await forgetAdmsDevice(prisma, sn);
  revalidatePath("/admin/checador");
}
