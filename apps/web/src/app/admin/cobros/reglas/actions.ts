"use server";

import { revalidatePath } from "next/cache";
import { prisma, refreshBlockedPickups, setCreditMode, setCreditRules } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function saveRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    await setCreditRules(prisma, { minWeeklyShipments: Number(fd.get("minWeeklyShipments")), cutWeekday: Number(fd.get("cutWeekday")) }, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Valores inválidos" };
  }
  revalidatePath("/admin/cobros/reglas");
  return { ok: "Reglas guardadas" };
}

export async function setModeAction(mode: "PREPAID" | "WEEKLY_CREDIT", _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const ids = fd.getAll("clientIds").map(String).filter(Boolean).slice(0, 1000);
  if (!ids.length) return { error: "Selecciona al menos un cliente" };
  const n = await setCreditMode(prisma, ids, mode, user.id);
  for (const id of ids) await refreshBlockedPickups(prisma, id);
  revalidatePath("/admin/cobros/reglas");
  revalidatePath("/admin/cobros");
  return { ok: `${n} cliente(s) en ${mode === "WEEKLY_CREDIT" ? "crédito semanal" : "prepago"}` };
}
