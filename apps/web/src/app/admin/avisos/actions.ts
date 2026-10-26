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
