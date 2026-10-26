"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveApplication, createApplication, prisma, rejectApplication, reviewDocument } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function reviewDocAction(docId: string, status: "APROBADO" | "RECHAZADO", comment: string): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  try {
    await reviewDocument(prisma, docId, status, comment || null, admin.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidatePath("/admin/personal", "layout");
  return { ok: status === "APROBADO" ? "Aprobado" : "Rechazado" };
}

export async function approveAction(appId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const entry = String(fd.get("entryTime") ?? "");
  const r = await approveApplication(prisma, appId, { employeeNo: Number(fd.get("employeeNo")), entryTime: /^\d{2}:\d{2}$/.test(entry) ? entry : undefined }, admin.id);
  if (!r.ok) return { error: r.error };
  redirect(`/admin/personal/${r.employeeId}`);
}

export async function rejectAction(appId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const note = String(fd.get("note") ?? "").trim();
  if (note.length < 3) return { error: "Escribe el motivo" };
  await rejectApplication(prisma, appId, note, admin.id);
  revalidatePath("/admin/personal/altas");
  return { ok: "Solicitud rechazada" };
}

/** RH genera un enlace de alta para mandarlo por WhatsApp. */
export async function newLinkAction(_: ActionState, fd: FormData): Promise<ActionState & { link?: string }> {
  await requireUser(["ADMIN"]);
  const { token } = await createApplication(prisma, String(fd.get("role") ?? "repartidor"));
  const base = process.env.PUBLIC_URL ?? "";
  revalidatePath("/admin/personal/altas");
  return { ok: "Enlace creado: cópialo y mándalo. Solo se muestra esta vez.", link: `${base}/alta/${token}` };
}
