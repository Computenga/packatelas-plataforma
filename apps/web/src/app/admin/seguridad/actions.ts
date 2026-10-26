"use server";

import { revalidatePath } from "next/cache";
import { audit, decryptSecret, encryptSecret, prisma, verifyTotp } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import type { ActionState } from "@/components/action-form";

/** Activa la verificación: el secreto propuesto viaja cifrado en el formulario hasta confirmarlo. */
export async function enableTwoFactor(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(STAFF_ROLES);
  let secret: string;
  try {
    secret = decryptSecret(String(fd.get("pending") ?? ""));
  } catch {
    return { error: "Recarga la página e inténtalo de nuevo" };
  }
  const step = verifyTotp(secret, String(fd.get("code") ?? ""));
  if (step == null) return { error: "El código no coincide. Revisa que la hora del teléfono sea automática." };
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encryptSecret(secret), totpLastStep: step } });
  await audit(prisma, { actorUserId: user.id, action: "user.2fa_enabled", entity: "User", entityId: user.id, summary: `${user.username} activó la verificación en dos pasos` });
  revalidatePath("/admin", "layout");
  return { ok: "Listo: a partir de ahora se te pedirá el código al entrar" };
}

export async function disableTwoFactor(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(STAFF_ROLES);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!row.totpSecret) return { error: "No está activa" };
  if (verifyTotp(decryptSecret(row.totpSecret), String(fd.get("code") ?? "")) == null) return { error: "Código incorrecto" };
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpLastStep: null } });
  await audit(prisma, { actorUserId: user.id, action: "user.2fa_disabled", entity: "User", entityId: user.id, summary: `${user.username} desactivó la verificación en dos pasos` });
  revalidatePath("/admin", "layout");
  return { ok: "Verificación desactivada" };
}
