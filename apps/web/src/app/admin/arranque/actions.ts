"use server";
import { revalidatePath } from "next/cache";
import { prisma, resetForCutover } from "@packatelas/db";
import type { ActionState } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { deleteEvidence } from "@/lib/uploads";

/** Limpieza única del día del arranque. Solo un administrador con verificación en dos pasos. */
export async function cutoverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { totpSecret: true } });
  if (!me?.totpSecret) return { error: "Activa tu verificación en dos pasos (Seguridad) antes de hacer el arranque" };
  try {
    const { evidenceKeys } = await resetForCutover(prisma, user.id, String(fd.get("confirm") ?? ""));
    let removed = 0;
    for (const k of evidenceKeys) if (await deleteEvidence(k)) removed++;
    revalidatePath("/admin", "layout");
    return { ok: `Listo: datos de prueba borrados (${removed} fotos). Sigue con la carga de saldos.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo completar" };
  }
}
