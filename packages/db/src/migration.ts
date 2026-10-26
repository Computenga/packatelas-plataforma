// Migración del sistema actual [A21]: clientes con sus datos, sucursal de recolección y saldo
// inicial. Re-ejecutable: los clientes existentes (mismo ID cmx…) se actualizan y el saldo
// inicial solo se registra una vez por cliente.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { PUBLIC_ID, referenceFromPublicId } from "./public-id.ts";

export { normalizePublicId } from "./public-id.ts";

export const OPENING_BALANCE_TAG = "Saldo inicial (migración)";
export const CLIENT_IMPORT_MAX = 2000;

export type ClientImportRow = {
  publicId: string; // cmx00114 o cmx00127-granjas
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  rfc?: string;
  legalName?: string;
  taxRegime?: string;
  taxZip?: string;
  cfdiUse?: string;
  tariffAmount?: number;
  pickupAddress?: string;
  active?: boolean;
  /** Positivo = el cliente debe; negativo = saldo a favor. */
  openingBalance?: number;
  /** Tarifa Flex dinámica + externos con tarifa fija. */
  flexDynamic?: boolean;
  chargingEnabled?: boolean;
  pickupExemptUntil?: string; // AAAA-MM-DD
  pickupExemptNote?: string;
};

export type ClientImportSummary = {
  status: "done" | "already";
  created: string[];
  updated: string[];
  balances: number;
  balanceSkipped: string[]; // ya tenían saldo inicial
};

/** Referencia de pago única: el ID en mayúsculas (CMX00127GRANJAS); si ya existe, se numera. */
function referenceFor(publicId: string, taken: Set<string>): string {
  const base = referenceFromPublicId(publicId);
  let ref = base;
  for (let i = 2; taken.has(ref); i++) ref = `${base}-${i}`;
  taken.add(ref);
  return ref;
}

const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

export async function importClients(
  prisma: PrismaClient,
  input: { batchId: string; rows: ClientImportRow[] },
  actorUserId?: string,
): Promise<ClientImportSummary> {
  if (!input.rows.length) throw new Error("No hay clientes para importar");
  if (input.rows.length > CLIENT_IMPORT_MAX) throw new Error(`Máximo ${CLIENT_IMPORT_MAX} clientes por carga`);
  const seen = new Set<string>();
  for (const r of input.rows) {
    if (!PUBLIC_ID.test(r.publicId)) throw new Error(`ID inválido: ${r.publicId}`);
    if (seen.has(r.publicId)) throw new Error(`ID repetido en el archivo: ${r.publicId}`);
    seen.add(r.publicId);
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"client-import"}))`;
      const prev = await tx.auditLog.findFirst({ where: { action: "clients.imported", entityId: input.batchId } });
      if (prev) return { ...(prev.data as Omit<ClientImportSummary, "status">), status: "already" as const };

      const existing = new Map(
        (await tx.client.findMany({ where: { publicId: { in: [...seen] } }, select: { id: true, publicId: true } })).map((c) => [c.publicId, c.id]),
      );
      const taken = new Set((await tx.client.findMany({ select: { paymentReference: true } })).map((c) => c.paymentReference));
      const summary: Omit<ClientImportSummary, "status"> = { created: [], updated: [], balances: 0, balanceSkipped: [] };

      for (const r of input.rows) {
        const data = {
          name: r.name.trim(),
          contactName: clean(r.contactName),
          phone: clean(r.phone),
          email: clean(r.email)?.toLowerCase(),
          rfc: clean(r.rfc)?.toUpperCase(),
          legalName: clean(r.legalName),
          taxRegime: clean(r.taxRegime),
          taxZip: clean(r.taxZip),
          cfdiUse: clean(r.cfdiUse),
          ...(r.tariffAmount != null ? { tariffAmount: new Prisma.Decimal(r.tariffAmount) } : {}),
          ...(r.active != null ? { active: r.active } : {}),
          ...(r.flexDynamic != null ? { tariffMode: r.flexDynamic ? ("FLEX_DYNAMIC_PLUS_FIXED" as const) : ("FIXED" as const) } : {}),
          ...(r.chargingEnabled != null ? { chargingEnabled: r.chargingEnabled } : {}),
          ...(r.pickupExemptUntil && /^\d{4}-\d{2}-\d{2}$/.test(r.pickupExemptUntil)
            ? { pickupExemptUntil: new Date(`${r.pickupExemptUntil}T23:59:59-06:00`), pickupExemptNote: clean(r.pickupExemptNote) ?? "Exención migrada" }
            : {}),
        };
        let clientId = existing.get(r.publicId);
        if (clientId) {
          // Solo se sobreescriben los campos que trae el archivo.
          const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
          await tx.client.update({ where: { id: clientId }, data: patch });
          summary.updated.push(r.publicId);
        } else {
          const c = await tx.client.create({
            data: {
              ...data,
              publicId: r.publicId,
              paymentReference: referenceFor(r.publicId, taken),
              branches: r.pickupAddress?.trim() ? { create: { name: "Principal", address: r.pickupAddress.trim() } } : undefined,
            },
          });
          clientId = c.id;
          summary.created.push(r.publicId);
        }

        if (r.openingBalance != null && r.openingBalance !== 0) {
          const has = await tx.ledgerEntry.findFirst({ where: { clientId, type: "ADJUSTMENT", description: OPENING_BALANCE_TAG } });
          if (has) summary.balanceSkipped.push(r.publicId);
          else {
            await tx.ledgerEntry.create({
              data: { clientId, type: "ADJUSTMENT", amount: new Prisma.Decimal(r.openingBalance.toFixed(2)), description: OPENING_BALANCE_TAG, createdById: actorUserId },
            });
            summary.balances++;
          }
        }
      }

      await audit(tx, {
        actorUserId,
        action: "clients.imported",
        entity: "ImportBatch",
        entityId: input.batchId,
        summary: `Migración de clientes: ${summary.created.length} nuevos, ${summary.updated.length} actualizados, ${summary.balances} saldos iniciales`,
        data: summary as unknown as Prisma.InputJsonValue,
      });
      return { ...summary, status: "done" as const };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
