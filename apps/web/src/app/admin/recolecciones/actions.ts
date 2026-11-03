"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminMarkPickup, assignPickup, cancelPickup, prisma, requestPickup } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function assignPickupAction(pickupId: string, fd: FormData) {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const driverId = String(fd.get("driverId") ?? "");
  if (!driverId) return;
  try {
    await assignPickup(prisma, pickupId, driverId, user.id);
  } catch {
    // estado cambió (p. ej. bloqueada); la página se refresca y lo muestra
  }
  revalidatePath("/admin/recolecciones");
}

export async function newPickupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const parsed = z
    .object({
      branchId: z.string().min(1, "Elige la sucursal"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha"),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const branch = await prisma.branch.findUnique({ where: { id: d.branchId } });
  if (!branch) return { error: "Sucursal no encontrada" };
  const p = await requestPickup(
    prisma,
    { clientId: branch.clientId, branchId: branch.id, ymd: d.date, note: d.note || undefined },
    user.id,
  );
  revalidatePath("/admin/recolecciones");
  if (p.existing) return { error: "Esa sucursal ya tiene recolección ese día; no se creó otra" };
  return p.status === "BLOCKED" ? { error: "Creada, pero bloqueada por adeudo del cliente" } : { ok: "Recolección creada" };
}

/** Cierre a mano: recolectada / no se pudo / cancelar (repetida u otro motivo). */
export async function closePickupAction(pickupId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const what = String(fd.get("what") ?? "");
  const note = String(fd.get("note") ?? "").trim();
  try {
    if (what === "cancel") await cancelPickup(prisma, pickupId, note || "Cancelada por administración", user.id);
    else if (what === "collected" || what === "failed") {
      const count = Number(fd.get("count"));
      await adminMarkPickup(prisma, pickupId, { collected: what === "collected", count: Number.isInteger(count) && count > 0 ? count : undefined, note }, user.id);
    } else return { error: "Elige qué pasó" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidatePath("/admin/recolecciones");
  return { ok: what === "cancel" ? "Recolección cancelada" : what === "collected" ? "Marcada como recolectada" : "Marcada como no recolectada" };
}
