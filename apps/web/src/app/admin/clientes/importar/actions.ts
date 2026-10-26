"use server";

import { z } from "zod";
import { CLIENT_IMPORT_MAX, importClients, OPENING_BALANCE_TAG, prisma, type ClientImportSummary } from "@packatelas/db";
import { PUBLIC_ID } from "@packatelas/db/public-id";
import { requireUser } from "@/lib/auth";

/** Para la revisión: cuáles ya existen y cuáles ya tienen saldo inicial. */
export async function previewClients(publicIds: string[]): Promise<{ existing: string[]; withBalance: string[] }> {
  await requireUser(["ADMIN"]);
  const ids = z.array(z.string().regex(PUBLIC_ID)).max(CLIENT_IMPORT_MAX).parse(publicIds);
  const found = await prisma.client.findMany({
    where: { publicId: { in: ids } },
    select: { publicId: true, ledger: { where: { type: "ADJUSTMENT", description: OPENING_BALANCE_TAG }, select: { id: true }, take: 1 } },
  });
  return { existing: found.map((c) => c.publicId), withBalance: found.filter((c) => c.ledger.length).map((c) => c.publicId) };
}

const opt = (max: number) => z.string().trim().max(max).optional();
const rowSchema = z.object({
  publicId: z.string().regex(PUBLIC_ID),
  name: z.string().trim().min(2).max(200),
  contactName: opt(300), phone: opt(300), email: opt(300), rfc: opt(20), legalName: opt(300),
  taxRegime: opt(300), taxZip: opt(10), cfdiUse: opt(300), pickupAddress: opt(300),
  tariffAmount: z.number().min(0).max(100000).optional(),
  openingBalance: z.number().min(-10_000_000).max(10_000_000).optional(),
  active: z.boolean().optional(),
  flexDynamic: z.boolean().optional(),
  chargingEnabled: z.boolean().optional(),
  pickupExemptUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pickupExemptNote: opt(300),
});

export async function importClientsAction(input: unknown): Promise<{ error?: string; summary?: ClientImportSummary }> {
  const user = await requireUser(["ADMIN"]);
  const parsed = z.object({ batchId: z.string().uuid(), rows: z.array(rowSchema).min(1).max(CLIENT_IMPORT_MAX) }).safeParse(input);
  if (!parsed.success) return { error: "Hay renglones inválidos; revisa la tabla" };
  try {
    return { summary: await importClients(prisma, parsed.data, user.id) };
  } catch (e) {
    console.error("[migración clientes]", e);
    return { error: e instanceof Error && /ID/.test(e.message) ? e.message : "No se pudo completar; no se guardó nada. Intenta de nuevo." };
  }
}
