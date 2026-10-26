"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveSignup, prisma, rejectSignup } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function approveAction(signupId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const zone = fd.get("zone") === "emx" ? "emx" : "cmx";
  const tariff = Number(fd.get("tariffAmount"));
  const r = await approveSignup(prisma, { signupId, tariffAmount: tariff, zone, note: String(fd.get("note") ?? "") }, user.id);
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/clientes");
  redirect(`/admin/clientes/${r.clientId}`);
}

export async function rejectAction(signupId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const ok = await rejectSignup(prisma, signupId, String(fd.get("note") ?? "").trim(), user.id);
  revalidatePath("/admin/clientes/solicitudes");
  return ok ? { ok: "Solicitud rechazada" } : { error: "Esta solicitud ya se revisó" };
}
