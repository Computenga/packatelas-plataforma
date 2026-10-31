"use server";

import { revalidatePath } from "next/cache";
import { NOTIFY_EVENTS, prisma, setNotifySettings, type NotifyEvent } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function saveNotifyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const enabled = Object.fromEntries((Object.keys(NOTIFY_EVENTS) as NotifyEvent[]).map((k) => [k, fd.get(`on_${k}`) === "on"])) as Record<NotifyEvent, boolean>;
  const reminderWeekday = Number(fd.get("reminderWeekday"));
  const reminderHour = Number(fd.get("reminderHour"));
  if (!(reminderWeekday >= 1 && reminderWeekday <= 7) || !(reminderHour >= 0 && reminderHour <= 23)) return { error: "Día u hora inválidos" };
  await setNotifySettings(prisma, { enabled, reminderWeekday, reminderHour }, user.id);
  revalidatePath("/admin/avisos");
  return { ok: "Guardado" };
}

export async function retryAction(id: string) {
  await requireUser(["ADMIN"]);
  await prisma.notification.updateMany({ where: { id, status: { in: ["FAILED", "SKIPPED"] } }, data: { status: "PENDING", attempts: 0, error: null, createdAt: new Date() } });
  revalidatePath("/admin/avisos");
}

export async function registerTemplatesAction(): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  const { registerTemplates } = await import("@/lib/wa-templates");
  const r = await registerTemplates();
  revalidatePath("/admin/avisos");
  if (r.errors.length) return { error: r.errors.join(" · ") };
  return { ok: r.created.length ? `Enviadas a revisión de Meta: ${r.created.join(", ")}` : "Todas las plantillas ya estaban registradas" };
}

export async function registerPhoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  const pin = String(fd.get("pin") ?? "").trim();
  if (!/^\d{6}$/.test(pin)) return { error: "El PIN debe ser de 6 dígitos" };
  const { registerPhone } = await import("@/lib/wa-templates");
  const r = await registerPhone(pin);
  revalidatePath("/admin/avisos");
  return r.ok ? { ok: "Número registrado en la API de WhatsApp" } : { error: r.error ?? "No se pudo registrar" };
}

/** Manda una plantilla de prueba (la de recolección asignada) al número que se indique. */
export async function testSendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const to = String(fd.get("to") ?? "");
  const { enqueueNotification, waPhone } = await import("@packatelas/db");
  if (!waPhone(to)) return { error: "Escribe un celular de 10 dígitos" };
  const ok = await enqueueNotification(prisma, {
    event: "recoleccion_asignada",
    to,
    params: [user.name.split(" ")[0] || "Hola", "hoy", "Bodega Packatelas", "Prueba"],
    dedupeKey: `prueba:${Date.now()}`,
  });
  revalidatePath("/admin/avisos");
  return ok ? { ok: "En cola: el proceso en segundo plano lo manda en unos segundos (míralo abajo en la bitácora)" } : { error: "No se pudo poner en cola (¿aviso apagado?)" };
}
