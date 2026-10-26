"use server";

import { importMlAccounts, prisma, registerScan, type ScanOutcome } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export async function scanAction(raw: string, branchHint?: string): Promise<ScanOutcome> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  if (typeof raw !== "string" || raw.length > 2000) return { status: "invalid", message: "Lectura inválida" };
  const hint = typeof branchHint === "string" && branchHint.length < 40 ? branchHint : undefined;
  return registerScan(prisma, { raw, actorUserId: user.id, source: "SCAN", branchHint: hint });
}

/** Cuenta ML desconocida al escanear: el administrador la liga a su cliente y se registra el envío. */
export async function linkAndScanAction(raw: string, senderId: string, publicId: string): Promise<ScanOutcome | { status: "error"; message: string }> {
  const user = await requireUser(["ADMIN"]);
  if (typeof raw !== "string" || raw.length > 2000 || !/^\d{3,15}$/.test(senderId) || typeof publicId !== "string") {
    return { status: "error", message: "Datos inválidos" };
  }
  const r = await importMlAccounts(prisma, [{ line: 1, sellerId: senderId, nickname: "", publicId }], user.id);
  if (!r.ok) return { status: "error", message: r.error.replace(/^Renglón 1: /, "") };
  return registerScan(prisma, { raw, actorUserId: user.id, source: "SCAN" });
}
