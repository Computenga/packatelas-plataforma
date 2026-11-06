"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { importLeads, importMlSellers, prisma, LEAD_IMPORT_MAX, type LeadImportSummary, type MlSellerImportSummary } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

// Textos largos se recortan en vez de rechazar el archivo completo.
const s = (max: number) => z.string().nullish().transform((v) => (v ?? "").trim().slice(0, max) || null);
const row = z.object({ at: s(40), businessName: s(200), legalName: s(200), contactName: s(200), phone: s(40), email: s(200), zone: z.enum(["cmx", "emx"]).nullish(), municipality: s(200), salesChannels: s(300), notes: s(1000) });

export async function importLeadsAction(rows: unknown, recentDays: number): Promise<{ error?: string; summary?: LeadImportSummary }> {
  const user = await requireUser(["ADMIN"]);
  const p = z.array(row).min(1).max(LEAD_IMPORT_MAX).safeParse(rows);
  if (!p.success) return { error: "El archivo tiene renglones inválidos" };
  const days = Number.isFinite(recentDays) ? Math.min(365, Math.max(1, Math.round(recentDays))) : 30;
  const summary = await importLeads(prisma, p.data, user.id, { recentDays: days, now: new Date() });
  revalidatePath("/admin/crm");
  return { summary };
}

const mlRow = z.object({ sellerId: s(20), nickname: s(160), phone1: s(40), phone2: s(40), email: s(200), city: s(120), state: s(40), address: s(300) });

/** Listado de vendedores que comparte MercadoLibre (en tandas de hasta 500). */
export async function importMlListAction(rows: unknown): Promise<{ error?: string; summary?: MlSellerImportSummary }> {
  const user = await requireUser(["ADMIN"]);
  const p = z.array(mlRow).min(1).max(500).safeParse(rows);
  if (!p.success) return { error: "El archivo tiene renglones inválidos" };
  const summary = await importMlSellers(prisma, p.data, user.id);
  revalidatePath("/admin/crm");
  return { summary };
}
