"use server";

import { revalidatePath } from "next/cache";
import { linkFlexDriver, lookupFlexDriver, prisma, type FlexLookup } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export async function lookupFlexAction(raw: string): Promise<FlexLookup> {
  await requireUser(["ADMIN", "DESPACHADOR"]);
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2000) return { ok: false, error: "Escanea el QR o escribe el número de envío" };
  try {
    return await lookupFlexDriver(prisma, raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo consultar a MercadoLibre" };
  }
}

export async function linkFlexAction(flexDriverId: string, driverId: string, shipmentId: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  try {
    const r = await linkFlexDriver(prisma, { flexDriverId, driverId, shipmentId, actorUserId: user.id });
    revalidatePath("/admin/repartidores");
    revalidatePath("/admin/repartidores/flex");
    return { ok: r.moved ? `Listo: el driver Flex ${flexDriverId} pasó de ${r.previous} a ${r.name}` : `Listo: driver Flex ${flexDriverId} vinculado a ${r.name}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo vincular" };
  }
}
