"use server";

import { revalidatePath } from "next/cache";
import { prisma, sendPortalInvites, setInviteOmit } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function toggleOmitAction(clientId: string, omit: boolean) {
  await requireUser(["ADMIN"]);
  await setInviteOmit(prisma, clientId, omit);
  revalidatePath("/admin/avisos/invitar");
}

export async function sendInvitesAction(_: ActionState): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const { templateStatuses } = await import("@/lib/wa-templates");
  const st = (await templateStatuses()) ?? [];
  const pending = ["pk_acceso_portal", "pk_conectar_ml"].filter((t) => st.find((s) => s.template === t)?.status !== "APPROVED");
  if (pending.length) return { error: `Meta aún no aprueba: ${pending.join(", ")}` };
  const r = await sendPortalInvites(prisma, user.id);
  revalidatePath("/admin/avisos/invitar");
  return { ok: `${r.queued} WhatsApp en cola (salen en 1–2 minutos). ${r.skipped} omitidos (excluidos, bajas o ya enviados hoy).` };
}
