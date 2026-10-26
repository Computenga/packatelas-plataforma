"use server";

import { revalidatePath } from "next/cache";
import { addJustification, audit, prisma } from "@packatelas/db";
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
