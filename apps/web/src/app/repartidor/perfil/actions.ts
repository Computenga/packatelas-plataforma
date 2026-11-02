"use server";

import { revalidatePath } from "next/cache";
import { linkFlexDriver, lookupFlexDriver, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function updatePhone(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["REPARTIDOR"]);
  const digits = String(fd.get("phone") ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return { error: "Escribe tu celular a 10 dígitos" };
  await prisma.driver.update({ where: { userId: user.id }, data: { phone: digits } });
  revalidatePath("/repartidor/perfil");
  return { ok: "Teléfono guardado" };
}

/**
 * El repartidor liga su usuario de Flex [P15]: escanea un paquete que ya tomó en la app Flex de ML,
 * se consulta a ML quién lo tiene asignado y ese ID de driver se liga a él. Nunca quita el ID a otro
 * repartidor: si ya es de alguien más, lo resuelve oficina.
 */
export async function selfLinkFlex(raw: string): Promise<ActionState> {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!driver) return { error: "Tu usuario no tiene perfil de repartidor" };
  const r = await lookupFlexDriver(prisma, raw).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "No se pudo consultar a Mercado Libre" }));
  if (!r.ok) return { error: `${r.error}. Asegúrate de haber escaneado primero ese paquete en tu app Flex de Mercado Libre.` };
  if (r.linked?.driverId === driver.id) return { ok: `Ya estabas vinculado (Flex ${r.nickname ?? r.flexDriverId}). ¡Todo listo!` };
  if (r.linked) return { error: `Ese paquete lo tiene en Flex ${r.linked.name}. Escanea uno que hayas tomado tú, o avisa a oficina.` };
  await linkFlexDriver(prisma, { flexDriverId: r.flexDriverId, driverId: driver.id, shipmentId: r.shipmentId, actorUserId: user.id });
  revalidatePath("/repartidor/perfil");
  revalidatePath("/repartidor");
  return { ok: `¡Listo! Tu usuario Flex ${r.nickname ?? r.flexDriverId} quedó vinculado. Lo que tomes en Flex se te asigna solo.` };
}
