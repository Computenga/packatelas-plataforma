"use server";

import { revalidatePath } from "next/cache";
import { prisma, receiveReturn, returnToSeller, setMaxAttempts, type ReturnOutcome } from "@packatelas/db";
import type { ActionState } from "@/components/action-form";
import { requireUser } from "@/lib/auth";

export async function returnScanAction(mode: "receive" | "deliver", raw: string): Promise<ReturnOutcome> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  if (typeof raw !== "string" || raw.length > 2000) return { status: "error", message: "Lectura inválida" };
  return mode === "deliver" ? returnToSeller(prisma, raw, user.id) : receiveReturn(prisma, raw, user.id);
}

export async function maxAttemptsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const n = Number(fd.get("max"));
  try {
    await setMaxAttempts(prisma, n, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Valor inválido" };
  }
  revalidatePath("/admin/devoluciones");
  return { ok: `Listo: ${n} intento(s)` };
}
