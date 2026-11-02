"use server";

import { revalidatePath } from "next/cache";
import { clientReply, clientResolve, createTicket, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { savePhotoFromForm } from "@/lib/support-upload";
import type { ActionState } from "@/components/action-form";

export async function newTicketAction(fd: FormData): Promise<ActionState & { id?: string }> {
  const { user, clientId } = await requireClient();
  const photo = await savePhotoFromForm(fd);
  if ("error" in photo) return { error: photo.error };
  try {
    const t = await createTicket(prisma, {
      clientId,
      userId: user.id,
      category: String(fd.get("category") ?? ""),
      subject: String(fd.get("subject") ?? ""),
      text: String(fd.get("text") ?? ""),
      orderRef: String(fd.get("orderRef") ?? ""),
      attachmentKey: photo.key,
    });
    revalidatePath("/cliente/soporte");
    return { ok: `Listo, recibimos tu reporte S-${String(t.number).padStart(5, "0")}. Te avisamos aquí cuando te respondamos.`, id: t.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo enviar" };
  }
}

export async function replyAction(ticketId: string, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const photo = await savePhotoFromForm(fd);
  if ("error" in photo) return { error: photo.error };
  try {
    await clientReply(prisma, { ticketId, clientId, userId: user.id, text: String(fd.get("text") ?? ""), attachmentKey: photo.key });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo enviar" };
  }
  revalidatePath(`/cliente/soporte/${ticketId}`);
  return { ok: "Enviado" };
}

export async function resolveAction(ticketId: string) {
  const { clientId } = await requireClient();
  await clientResolve(prisma, ticketId, clientId);
  revalidatePath(`/cliente/soporte/${ticketId}`);
  revalidatePath("/cliente/soporte");
}
