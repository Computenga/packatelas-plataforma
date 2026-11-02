"use server";

import { revalidatePath } from "next/cache";
import { assignTicket, prisma, setTicketStatus, staffReply, type TicketStatus } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { savePhotoFromForm } from "@/lib/support-upload";
import type { ActionState } from "@/components/action-form";

const STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "RESOLVED"];

export async function staffReplyAction(ticketId: string, fd: FormData): Promise<ActionState> {
  const user = await requireUser(STAFF_ROLES);
  const photo = await savePhotoFromForm(fd);
  if ("error" in photo) return { error: photo.error };
  const next = String(fd.get("next") ?? "WAITING_CLIENT") as TicketStatus;
  try {
    await staffReply(prisma, {
      ticketId,
      userId: user.id,
      text: String(fd.get("text") ?? ""),
      internal: fd.get("internal") === "on",
      next: STATUSES.includes(next) ? next : "WAITING_CLIENT",
      attachmentKey: photo.key,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo enviar" };
  }
  revalidatePath(`/admin/soporte/${ticketId}`);
  revalidatePath("/admin/soporte");
  return { ok: fd.get("internal") === "on" ? "Nota guardada" : "Respuesta enviada a la tienda" };
}

export async function statusAction(ticketId: string, status: TicketStatus) {
  const user = await requireUser(STAFF_ROLES);
  if (!STATUSES.includes(status)) return;
  await setTicketStatus(prisma, ticketId, status, user.id);
  revalidatePath(`/admin/soporte/${ticketId}`);
  revalidatePath("/admin/soporte");
}

export async function assignAction(ticketId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(STAFF_ROLES);
  const to = String(fd.get("assignedToId") ?? "") || null;
  if (to && !(await prisma.user.findFirst({ where: { id: to, role: { in: STAFF_ROLES }, active: true }, select: { id: true } }))) return { error: "Usuario no válido" };
  await assignTicket(prisma, ticketId, to, user.id);
  revalidatePath(`/admin/soporte/${ticketId}`);
  return { ok: "Responsable actualizado" };
}
