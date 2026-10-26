"use server";

import { revalidatePath } from "next/cache";
import { assignOrders, prisma, unassignOrders } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []);

export async function assignAction(orderIds: string[], driverId: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const list = ids(orderIds);
  if (!list.length) return { error: "Selecciona al menos un pedido" };
  if (typeof driverId !== "string" || !driverId) return { error: "Elige un repartidor" };
  try {
    const n = await assignOrders(prisma, list, driverId, user.id);
    revalidatePath("/admin/despacho");
    return { ok: `${n} pedido(s) asignado(s)` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo asignar" };
  }
}

export async function unassignAction(orderIds: string[]): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const n = await unassignOrders(prisma, ids(orderIds), user.id);
  revalidatePath("/admin/despacho");
  return { ok: `${n} pedido(s) regresado(s) a por asignar` };
}
