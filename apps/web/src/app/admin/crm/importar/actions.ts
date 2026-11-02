"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { importLeads, prisma, LEAD_IMPORT_MAX, type LeadImportSummary } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

// Textos largos se recortan en vez de rechazar el archivo completo.
const s = (max: number) => z.string().nullish().transform((v) => (v ?? "").trim().slice(0, max) || null);
const row = z.object({ at: s(40), businessName: s(200), contactName: s(200), phone: s(40), email: s(200), zone: z.enum(["cmx", "emx"]).nullish(), salesChannels: s(300), notes: s(1000) });

export async function importLeadsAction(rows: unknown, recentDays: number): Promise<{ error?: string; summary?: LeadImportSummary }> {
  const user = await requireUser(["ADMIN"]);
  const p = z.array(row).min(1).max(LEAD_IMPORT_MAX).safeParse(rows);
  if (!p.success) return { error: "El archivo tiene renglones inválidos" };
  const days = Number.isFinite(recentDays) ? Math.min(365, Math.max(1, Math.round(recentDays))) : 30;
  const summary = await importLeads(prisma, p.data, user.id, { recentDays: days, now: new Date() });
  revalidatePath("/admin/crm");
  return { summary };
}
