"use server";

import { revalidatePath } from "next/cache";
import { prisma, saveMpSettings } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function saveMpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    await saveMpSettings(
      prisma,
      {
        enabled: fd.get("enabled") === "on",
        feeMode: fd.get("feeMode") === "fijo" ? "fijo" : "porcentaje",
        feeValue: Number(fd.get("feeValue")),
        minAmount: Number(fd.get("minAmount")),
      },
      user.id,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Valores inválidos" };
  }
  revalidatePath("/admin/cobros/mercadopago");
  return { ok: "Guardado" };
}
