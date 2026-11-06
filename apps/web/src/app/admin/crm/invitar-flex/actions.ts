"use server";

import { revalidatePath } from "next/cache";
import { prisma, sendFlexInvites } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function sendFlexInvitesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const { templateStatuses } = await import("@/lib/wa-templates");
  const st = (await templateStatuses()) ?? [];
  const t = st.find((s) => s.template === "pk_invitacion_flex");
  if (t?.status !== "APPROVED") return { error: "Meta aún no aprueba la plantilla pk_invitacion_flex" };
  if (t.outdated) return { error: "La plantilla en Meta es la versión anterior: actualízala en Avisos → Plantillas" };
  const zone = fd.get("zone") === "cmx" || fd.get("zone") === "emx" ? String(fd.get("zone")) : null;
  const limit = Number(fd.get("limit")) || 150;
  const r = await sendFlexInvites(prisma, user.id, { zone, limit });
  revalidatePath("/admin/crm/invitar-flex");
  return { ok: `${r.queued} invitaciones en cola (salen en 1–2 minutos).` };
}
