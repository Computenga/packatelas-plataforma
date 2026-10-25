"use server";

import { prisma, registerScan, type ScanOutcome } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export async function scanAction(raw: string): Promise<ScanOutcome> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  if (typeof raw !== "string" || raw.length > 2000) return { status: "invalid", message: "Lectura inválida" };
  return registerScan(prisma, { raw, actorUserId: user.id, source: "SCAN" });
}
