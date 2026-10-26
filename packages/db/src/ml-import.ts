// Importar cuentas MercadoLibre → cliente desde el sistema actual [A21, A02].
// Re-ejecutable: una cuenta ya ligada se mueve al cliente indicado; si el cliente tiene
// sucursal activa y la cuenta no tiene ninguna, llega a la primera como predeterminada.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { normalizePublicId } from "./public-id.ts";

export type MlImportRow = { sellerId: string; nickname: string; publicId: string };
export type MlImportPlan = { line: number; row: MlImportRow; action: "nueva" | "mover" | "igual"; clientName?: string; error?: string }[];

export function parseMlImport(text: string): { rows: (MlImportRow & { line: number })[]; error?: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], error: "Pega las cuentas" };
  const split = (l: string) => l.split(/\t|;|,/).map((c) => c.trim());
  const start = /vendedor|seller|cuenta/i.test(lines[0]) ? 1 : 0;
  return {
    rows: lines.slice(start).map((l, i) => {
      const [sellerId = "", nickname = "", publicId = ""] = split(l);
      return { line: i + 1 + start, sellerId: sellerId.replace(/\D/g, ""), nickname: nickname.slice(0, 80), publicId: normalizePublicId(publicId) ?? publicId.toLowerCase() };
    }),
  };
}

export async function planMlImport(prisma: PrismaClient, rows: (MlImportRow & { line: number })[]): Promise<MlImportPlan> {
  const clients = new Map((await prisma.client.findMany({ where: { publicId: { in: rows.map((r) => r.publicId) } }, select: { id: true, publicId: true, name: true } })).map((c) => [c.publicId, c]));
  const existing = new Map((await prisma.mlAccount.findMany({ where: { mlUserId: { in: rows.filter((r) => /^\d{3,15}$/.test(r.sellerId)).map((r) => BigInt(r.sellerId)) } }, select: { mlUserId: true, clientId: true } })).map((a) => [a.mlUserId.toString(), a.clientId]));
  const seen = new Set<string>();
  return rows.map((r) => {
    const base = { line: r.line, row: r };
    if (!/^\d{3,15}$/.test(r.sellerId)) return { ...base, action: "igual" as const, error: "Vendedor ML inválido" };
    if (seen.has(r.sellerId)) return { ...base, action: "igual" as const, error: "Repetido en el archivo" };
    seen.add(r.sellerId);
    const c = clients.get(r.publicId);
    if (!c) return { ...base, action: "igual" as const, error: `No existe el cliente ${r.publicId || "(vacío)"}` };
    const cur = existing.get(r.sellerId);
    return { ...base, clientName: c.name, action: !cur ? "nueva" : cur === c.id ? "igual" : "mover" };
  });
}

export async function importMlAccounts(prisma: PrismaClient, rows: (MlImportRow & { line: number })[], actorUserId: string) {
  const plan = await planMlImport(prisma, rows);
  const bad = plan.filter((p) => p.error);
  if (bad.length) return { ok: false as const, error: `Renglón ${bad[0].line}: ${bad[0].error}` };
  let created = 0, moved = 0;
  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      const client = await tx.client.findUniqueOrThrow({ where: { publicId: p.row.publicId }, include: { branches: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
      const mlUserId = BigInt(p.row.sellerId);
      const acc = await tx.mlAccount.upsert({
        where: { mlUserId },
        create: { mlUserId, nickname: p.row.nickname || `Vendedor ${p.row.sellerId}`, clientId: client.id, status: "TOKEN_EXPIRED" },
        update: { clientId: client.id, ...(p.row.nickname ? { nickname: p.row.nickname } : {}) },
      });
      if (p.action === "mover") {
        await tx.mlAccountRoute.deleteMany({ where: { mlAccountId: acc.id } });
        moved++;
      }
      if (p.action === "nueva") created++;
      const hasRoute = await tx.mlAccountRoute.count({ where: { mlAccountId: acc.id } });
      if (!hasRoute && client.branches[0]) {
        await tx.mlAccountRoute.create({ data: { mlAccountId: acc.id, branchId: client.branches[0].id, isDefault: true } });
      }
    }
    await audit(tx, { actorUserId, action: "ml_account.imported", entity: "MlAccount", entityId: "import", summary: `Importación de cuentas ML: ${created} nuevas, ${moved} movidas` });
  }, { timeout: 60_000 });
  return { ok: true as const, created, moved, unchanged: plan.length - created - moved };
}
