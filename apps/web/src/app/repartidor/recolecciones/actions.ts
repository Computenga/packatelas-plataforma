"use server";

import { revalidatePath } from "next/cache";
import { completePickup, prisma, startNextPickup, startPickupRoute } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { publicTrackingUrl } from "@/lib/tracking";

async function me() {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) throw new Error("Sin perfil de repartidor");
  return { user, driver };
}

/** El repartidor sale hacia esta recolección: la tienda recibe el enlace de seguimiento. */
export async function goToPickupAction(pickupId: string): Promise<{ ok: boolean }> {
  const { user, driver } = await me();
  const ok = await startPickupRoute(prisma, pickupId, driver.id, { trackingUrl: publicTrackingUrl, actorUserId: user.id }).catch(() => false);
  revalidatePath("/repartidor/recolecciones");
  return { ok };
}

export type PickupDoneInput = { failed?: boolean; count?: number; note?: string; photoKeys?: string[]; lat?: number; lng?: number };

/** Confirma (con fotos y número de paquetes) o reporta que no se pudo; la siguiente pasa a "en camino". */
export async function completePickupAction(pickupId: string, input: PickupDoneInput): Promise<{ error?: string; ok?: string }> {
  const { user, driver } = await me();
  const failed = !!input.failed;
  const note = (input.note ?? "").toString().trim().slice(0, 300) || undefined;
  if (failed && !note) return { error: "Escribe el motivo" };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  try {
    await completePickup(
      prisma,
      {
        pickupId,
        driverId: driver.id,
        collected: !failed,
        count: failed ? undefined : Number(input.count),
        note,
        photoKeys: Array.isArray(input.photoKeys) ? input.photoKeys.filter((k): k is string => typeof k === "string") : [],
        lat: num(input.lat),
        lng: num(input.lng),
      },
      user.id,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  await startNextPickup(prisma, driver.id, { trackingUrl: publicTrackingUrl }).catch(() => null);
  revalidatePath("/repartidor/recolecciones");
  return { ok: failed ? "Recolección reportada" : `Recolección confirmada con ${input.count} paquete(s)` };
}
