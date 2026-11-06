"use server";

import { revalidatePath } from "next/cache";
import { addLeadActivity, audit, phoneKey, prisma, recordOutbound, replyWindow, waKey } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

/** Respuesta desde el portal (texto libre dentro de la ventana de 24 h). */
export async function replyAction(phone: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const to = waKey(phone);
  const text = String(fd.get("text") ?? "").trim();
  if (!text) return { error: "Escribe el mensaje" };
  if (text.length > 4000) return { error: "Máximo 4000 caracteres" };
  const w = await replyWindow(prisma, to);
  if (!w.open) return { error: "Pasaron más de 24 h desde su último mensaje: WhatsApp ya no deja responder con texto libre hasta que vuelva a escribir" };
  const { sendWhatsappTextDetailed } = await import("@/lib/wa-templates");
  const r = await sendWhatsappTextDetailed(to, text);
  await recordOutbound(prisma, { phone: to, kind: "text", text, waId: r.ok ? r.id : null, userId: user.id, error: r.ok ? null : r.error });
  if (!r.ok) return { error: r.error };
  // En la ficha del prospecto (si es del CRM) queda el contacto.
  const key = phoneKey(to);
  const lead = key ? await prisma.lead.findFirst({ where: { phoneKey: key }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;
  if (lead) await addLeadActivity(prisma, lead.id, "whatsapp", `Respondió por WhatsApp desde el portal: «${text.slice(0, 300)}»`, user.id);
  await audit(prisma, { actorUserId: user.id, action: "whatsapp.reply", entity: "WaMessage", entityId: to, summary: `Respuesta por WhatsApp a …${to.slice(-4)}` });
  revalidatePath("/admin/whatsapp");
  return { ok: "Enviado" };
}
