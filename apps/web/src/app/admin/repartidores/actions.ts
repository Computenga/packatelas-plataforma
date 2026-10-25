"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, prisma, Prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const driverSchema = z.object({
  phone: z.string().trim().optional(),
  vehicleType: z.string().trim().optional(),
  plate: z.string().trim().toUpperCase().optional(),
});

export async function updateDriver(driverId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const parsed = driverSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  await prisma.driver.update({
    where: { id: driverId },
    data: { phone: d.phone || null, vehicleType: d.vehicleType || null, plate: d.plate || null },
  });
  await audit(prisma, { actorUserId: user.id, action: "driver.updated", entity: "Driver", entityId: driverId, summary: "Datos de repartidor actualizados" });
  revalidatePath("/admin/repartidores");
  return { ok: "Guardado" };
}

/** Vincula el ID de driver Flex de ML para que sus envíos se asignen solos al escanear [A05]. */
export async function linkFlex(driverId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const raw = String(fd.get("flexDriverId") ?? "").trim();
  if (!/^\d{4,15}$/.test(raw)) return { error: "El ID Flex son solo números" };
  const flexDriverId = BigInt(raw);
  const existing = await prisma.flexIdentity.findUnique({ where: { flexDriverId }, include: { driver: { include: { user: true } } } });
  if (existing && existing.driverId !== driverId && fd.get("force") !== "on") {
    return { error: `Ese ID Flex está vinculado a ${existing.driver.user.name}. Marca "reemplazar" para moverlo.` };
  }
  await prisma.flexIdentity.upsert({
    where: { flexDriverId },
    update: { driverId },
    create: { flexDriverId, driverId },
  });
  await audit(prisma, {
    actorUserId: user.id,
    action: "flex.linked",
    entity: "Driver",
    entityId: driverId,
    summary: `ID Flex ${raw} vinculado${existing && existing.driverId !== driverId ? ` (antes con ${existing.driver.user.name})` : ""}`,
  });
  revalidatePath("/admin/repartidores");
  return { ok: `ID Flex ${raw} vinculado` };
}

export async function unlinkFlex(flexId: string) {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  try {
    const f = await prisma.flexIdentity.delete({ where: { id: flexId } });
    await audit(prisma, { actorUserId: user.id, action: "flex.unlinked", entity: "Driver", entityId: f.driverId, summary: `ID Flex ${f.flexDriverId} desvinculado` });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025")) throw e;
  }
  revalidatePath("/admin/repartidores");
}
