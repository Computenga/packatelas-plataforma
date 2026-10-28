"use server";

import { revalidatePath } from "next/cache";
import { prisma, saveCourierSettings, sendCourierReport } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function saveCourierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const enabled = fd.get("enabled") === "on";
  if (enabled && fd.get("confirm") !== "ENVIAR A MERCADOLIBRE") return { error: "Para encender el envío automático escribe ENVIAR A MERCADOLIBRE" };
  try {
    await saveCourierSettings(prisma, { enabled, expectedUserId: String(fd.get("expectedUserId") ?? "").trim() || null }, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidatePath("/admin/mercadolibre/mensajeria");
  return { ok: enabled ? "Envío automático ENCENDIDO" : "Guardado (envío automático apagado)" };
}

/** Prueba: reporta UN envío a ML aunque el envío automático esté apagado. */
export async function testCourierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const id = String(fd.get("shipmentId") ?? "").trim();
  if (!/^\d{10,13}$/.test(id)) return { error: "Elige un envío" };
  const r = await sendCourierReport(prisma, BigInt(id), { source: "prueba", actorUserId: user.id });
  revalidatePath("/admin/mercadolibre/mensajeria");
  if (r.status === "already") return { ok: `El envío ${id} ya se había reportado` };
  if (r.status === "unauthorized") return { error: "La cuenta de mensajería aún no está autorizada" };
  if (r.status === "sent") return { ok: `MercadoLibre aceptó el envío ${id} (HTTP ${r.httpStatus})` };
  return { error: `MercadoLibre respondió HTTP ${r.httpStatus}: ${r.body?.slice(0, 300) || "sin detalle"}` };
}
