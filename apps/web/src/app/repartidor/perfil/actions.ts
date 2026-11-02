"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function updatePhone(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["REPARTIDOR"]);
  const digits = String(fd.get("phone") ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return { error: "Escribe tu celular a 10 dígitos" };
  await prisma.driver.update({ where: { userId: user.id }, data: { phone: digits } });
  revalidatePath("/repartidor/perfil");
  return { ok: "Teléfono guardado" };
}
