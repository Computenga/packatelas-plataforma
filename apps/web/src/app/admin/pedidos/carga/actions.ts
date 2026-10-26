"use server";

import { z } from "zod";
import { IMPORT_MAX_ROWS, importOrders, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { geocodeAddress } from "@/lib/geocode-providers";

export type GeoAnswer = { lat: number; lng: number; precise: boolean; label: string } | null;

/** Busca coordenadas de varias direcciones (máx. 500), de 4 en 4 para no saturar al proveedor. */
export async function geocodeBatch(queries: string[]): Promise<GeoAnswer[]> {
  await requireUser(["ADMIN", "OPERADOR"]);
  const list = z.array(z.string().max(400)).max(IMPORT_MAX_ROWS).parse(queries);
  const out: GeoAnswer[] = new Array(list.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const hit = await geocodeAddress(list[i]).catch(() => null);
      out[i] = hit ? { lat: hit.lat, lng: hit.lng, precise: hit.precise, label: hit.label } : null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
  return out;
}

const text = (max: number) => z.string().trim().max(max).optional();
const rowSchema = z.object({
  recipientName: z.string().trim().min(2).max(200),
  recipientPhone: text(40),
  addressLine: z.string().trim().min(5).max(200),
  neighborhood: text(200),
  city: text(200),
  state: text(200),
  zip: z.string().regex(/^\d{5}$/).optional(),
  instructions: text(500),
  itemsSummary: text(200),
  lat: z.number().min(14).max(33).optional(),
  lng: z.number().min(-118).max(-86).optional(),
});
const importSchema = z.object({
  batchId: z.string().uuid(),
  clientId: z.string().min(1),
  branchId: z.string().optional(),
  rows: z.array(rowSchema).min(1).max(IMPORT_MAX_ROWS),
});

export type ImportAnswer = { error?: string; codes?: string[]; already?: boolean };

export async function createImportedOrders(input: unknown): Promise<ImportAnswer> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: "Hay renglones inválidos; revisa la tabla y vuelve a intentar" };
  const d = parsed.data;
  const client = await prisma.client.findUnique({ where: { id: d.clientId }, include: { branches: { where: { active: true } } } });
  if (!client?.active) return { error: "Cliente no encontrado o inactivo" };
  const branchId = d.branchId && client.branches.some((b) => b.id === d.branchId) ? d.branchId : client.branches[0]?.id;
  try {
    const r = await importOrders(prisma, { batchId: d.batchId, clientId: client.id, branchId, rows: d.rows }, user.id);
    return { codes: r.codes, already: r.status === "already" };
  } catch (e) {
    console.error("[carga masiva]", e);
    return { error: "No se pudo completar la carga; no se creó ningún pedido. Intenta de nuevo." };
  }
}
