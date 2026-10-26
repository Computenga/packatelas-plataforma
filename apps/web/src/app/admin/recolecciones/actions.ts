"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assignPickup, prisma, requestPickup } from "@packatelas/db";
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
      expectedCount: z.union([z.coerce.number().int().min(1).max(5000), z.literal("")]).optional(),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const branch = await prisma.branch.findUnique({ where: { id: d.branchId } });
  if (!branch) return { error: "Sucursal no encontrada" };
  const p = await requestPickup(
    prisma,
    { clientId: branch.clientId, branchId: branch.id, ymd: d.date, expectedCount: d.expectedCount === "" ? undefined : d.expectedCount, note: d.note || undefined },
    user.id,
  );
  revalidatePath("/admin/recolecciones");
  return p.status === "BLOCKED" ? { error: "Creada, pero bloqueada por adeudo del cliente" } : { ok: "Recolección creada" };
}
