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
        tiers: [0, 1, 2, 3, 4]
          .map((i) => ({ upTo: String(fd.get(`upTo${i}`) ?? "").trim(), percent: String(fd.get(`percent${i}`) ?? "").trim(), fixed: String(fd.get(`fixed${i}`) ?? "").trim() }))
          .filter((t) => t.upTo || t.percent || t.fixed || false)
          .map((t) => ({ upTo: t.upTo ? Number(t.upTo) : null, percent: Number(t.percent || 0), fixed: Number(t.fixed || 0) })),
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
