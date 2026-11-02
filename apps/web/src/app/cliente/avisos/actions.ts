"use server";

import { revalidatePath } from "next/cache";
import { prisma, CLIENT_PUSH_EVENTS } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function savePrefs(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["CLIENTE"]);
  const prefs = Object.fromEntries(CLIENT_PUSH_EVENTS.map((e) => [e.key, fd.get(e.key) === "on"]));
  await prisma.user.update({ where: { id: user.id }, data: { notifyPrefs: prefs } });
  revalidatePath("/cliente/avisos");
  return { ok: "Listo, guardamos tus avisos" };
}
