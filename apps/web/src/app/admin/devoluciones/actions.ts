"use server";

import { prisma, receiveReturn, returnToSeller, type ReturnOutcome } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export async function returnScanAction(mode: "receive" | "deliver", raw: string): Promise<ReturnOutcome> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  if (typeof raw !== "string" || raw.length > 2000) return { status: "error", message: "Lectura inválida" };
  return mode === "deliver" ? returnToSeller(prisma, raw, user.id) : receiveReturn(prisma, raw, user.id);
}
