"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pickupDateFor, pickupDayLabel, prisma, requestPickup } from "@packatelas/db";
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
  // Después de las 12:00 (o en domingo) pasa al siguiente día hábil.
  const when = pickupDateFor(d.date);
  try {
    const p = await requestPickup(
      prisma,
      { clientId, branchId: d.branchId, ymd: when.ymd, expectedCount: d.expectedCount === "" ? undefined : d.expectedCount, note: d.note || undefined },
      user.id,
    );
    revalidatePath("/cliente/recolecciones");
    return p.status === "BLOCKED"
      ? { error: "Registramos tu solicitud, pero está en pausa por saldo pendiente. Revisa tu estado de cuenta." }
      : { ok: `Recolección agendada para el ${pickupDayLabel(when.ymd)}${when.moved ? " (se pidió después de las 12:00 pm o en día no hábil, así que pasó al siguiente día hábil)" : ""}. Te llegará el folio por WhatsApp.` };
  } catch {
    return { error: "Sucursal inválida" };
  }
}
