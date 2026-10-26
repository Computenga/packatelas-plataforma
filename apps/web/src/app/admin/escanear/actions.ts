"use server";

import { prisma, registerScan, type ScanOutcome } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export async function scanAction(raw: string, branchHint?: string): Promise<ScanOutcome> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  if (typeof raw !== "string" || raw.length > 2000) return { status: "invalid", message: "Lectura inválida" };
  const hint = typeof branchHint === "string" && branchHint.length < 40 ? branchHint : undefined;
  return registerScan(prisma, { raw, actorUserId: user.id, source: "SCAN", branchHint: hint });
}
