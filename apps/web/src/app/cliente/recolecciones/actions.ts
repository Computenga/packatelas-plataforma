"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, requestPickup } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import type { ActionState } from "@/components/action-form";

export async function requestPickupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const parsed = z
    .object({
      branchId: z.string().min(1, "Elige la sucursal"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha").refine((d) => d >= today, "La fecha no puede ser pasada"),
      expectedCount: z.union([z.coerce.number().int().min(1).max(5000), z.literal("")]).optional(),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const p = await requestPickup(
      prisma,
      { clientId, branchId: d.branchId, ymd: d.date, expectedCount: d.expectedCount === "" ? undefined : d.expectedCount, note: d.note || undefined },
      user.id,
    );
    revalidatePath("/cliente/recolecciones");
    return p.status === "BLOCKED"
      ? { error: "Registramos tu solicitud, pero está en pausa por saldo pendiente. Revisa tu estado de cuenta." }
      : { ok: "Recolección solicitada" };
  } catch {
    return { error: "Sucursal inválida" };
  }
}
