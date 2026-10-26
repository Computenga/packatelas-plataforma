"use server";

import { revalidatePath } from "next/cache";
import { completePickup, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function completePickupAction(pickupId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) return { error: "Sin perfil de repartidor" };
  const failed = fd.get("failed") === "1";
  const note = String(fd.get("note") ?? "").trim() || undefined;
  const count = Number(fd.get("count"));
  if (failed && !note) return { error: "Escribe el motivo" };
  try {
    await completePickup(prisma, { pickupId, driverId: driver.id, collected: !failed, count: failed ? undefined : count, note }, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidatePath("/repartidor/recolecciones");
  return { ok: failed ? "Recolección reportada" : `Recolección confirmada con ${count} paquete(s)` };
}
