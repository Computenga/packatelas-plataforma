"use server";

import { redirect } from "next/navigation";
import { createDemoFlow, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function createDemoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  let code: string;
  try {
    code = (await createDemoFlow(prisma, { phone: String(fd.get("phone") ?? ""), actorUserId: user.id })).code;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo crear" };
  }
  redirect(`/admin/depurar?code=${code}`);
}
