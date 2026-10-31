// Prepago y crédito semanal [F08] y antigüedad de saldos [F11].
//
// - Prepago: si el saldo pasa del límite (0 por omisión), se bloquea la recolección.
// - Crédito semanal: puede acumular durante la semana. El día de corte (lunes) a las 00:00
//   amanece bloqueado si no liquidó todo lo cargado ANTES del corte; se desbloquea al pagarlo.
//   Si tiene límite en pesos, también se bloquea al rebasarlo a media semana.
import { Prisma, type PrismaClient, type CreditMode } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export type CreditRules = { minWeeklyShipments: number; cutWeekday: number /* 1 = lunes … 7 = domingo */ };
export const DEFAULT_CREDIT_RULES: CreditRules = { minWeeklyShipments: 100, cutWeekday: 1 };
const RULES_KEY = "credit.rules";
const TZ_OFFSET = "-06:00"; // Ciudad de México (sin horario de verano desde 2022)

export async function getCreditRules(db: Db): Promise<CreditRules> {
  const s = await db.setting.findUnique({ where: { key: RULES_KEY } });
  const v = (s?.value ?? {}) as Partial<CreditRules>;
  return {
    minWeeklyShipments: Number.isInteger(v.minWeeklyShipments) && v.minWeeklyShipments! >= 0 ? v.minWeeklyShipments! : DEFAULT_CREDIT_RULES.minWeeklyShipments,
    cutWeekday: Number.isInteger(v.cutWeekday) && v.cutWeekday! >= 1 && v.cutWeekday! <= 7 ? v.cutWeekday! : DEFAULT_CREDIT_RULES.cutWeekday,
  };
}

export async function setCreditRules(prisma: PrismaClient, rules: CreditRules, actorUserId?: string) {
  if (!Number.isInteger(rules.minWeeklyShipments) || rules.minWeeklyShipments < 0) throw new Error("Envíos por semana inválidos");
  if (!Number.isInteger(rules.cutWeekday) || rules.cutWeekday < 1 || rules.cutWeekday > 7) throw new Error("Día de corte inválido");
  await prisma.setting.upsert({ where: { key: RULES_KEY }, update: { value: rules }, create: { key: RULES_KEY, value: rules } });
  await audit(prisma, { actorUserId, action: "settings.credit_rules", entity: "Setting", entityId: RULES_KEY, summary: `Reglas de crédito: ${rules.minWeeklyShipments} envíos/semana, corte día ${rules.cutWeekday}` });
}

/** Inicio (00:00 hora CDMX) del último día de corte, hoy incluido. */
export function lastCutoff(now: Date, cutWeekday: number): Date {
  const local = new Date(now.getTime() - 6 * 3600_000); // reloj de CDMX expresado en UTC
  const iso = ((local.getUTCDay() + 6) % 7) + 1; // 1 = lunes
  const back = (iso - cutWeekday + 7) % 7;
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - back));
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00${TZ_OFFSET}`);
}

export type AccountState = {
  clientId: string;
  balance: number;
  /** Lo que ya debió pagarse: cargos anteriores al corte menos todos los abonos. */
  overdue: number;
  mode: CreditMode;
  blocked: boolean;
  exempt: boolean;
  reason: string | null;
};

type ClientCredit = { id: string; creditMode: CreditMode; creditLimit: Prisma.Decimal | null; pickupExemptUntil: Date | null };

export function decideState(c: ClientCredit, balance: number, overdue: number, now: Date): AccountState {
  const exempt = !!c.pickupExemptUntil && c.pickupExemptUntil > now;
  const limit = c.creditLimit != null ? Number(c.creditLimit) : null;
  let reason: string | null = null;
  if (c.creditMode === "WEEKLY_CREDIT") {
    if (overdue > 0.005) reason = "Saldo de la semana anterior sin liquidar";
    else if (limit != null && limit > 0 && balance > limit + 0.005) reason = "Rebasó su límite de crédito";
  } else if (balance > (limit ?? 0) + 0.005) {
    reason = limit ? "Rebasó su límite" : "Tiene saldo pendiente";
  }
  return { clientId: c.id, balance, overdue: Math.max(0, overdue), mode: c.creditMode, exempt, blocked: !!reason && !exempt, reason: exempt ? null : reason };
}

/** Estado de cobranza de varios clientes con una sola consulta al libro. */
export async function accountStates(db: Db, clientIds?: string[], now = new Date()): Promise<Map<string, AccountState>> {
  const rules = await getCreditRules(db);
  const cutoff = lastCutoff(now, rules.cutWeekday);
  const clients = await db.client.findMany({
    where: clientIds ? { id: { in: clientIds } } : undefined,
    select: { id: true, creditMode: true, creditLimit: true, pickupExemptUntil: true },
  });
  const sums = await db.$queryRaw<{ clientId: string; balance: Prisma.Decimal; overdue: Prisma.Decimal }[]>`
    SELECT "clientId",
           SUM(amount) AS balance,
           SUM(CASE WHEN "createdAt" < ${cutoff} OR amount < 0 THEN amount ELSE 0 END) AS overdue
    FROM "LedgerEntry"
    ${clientIds ? Prisma.sql`WHERE "clientId" IN (${Prisma.join(clientIds)})` : Prisma.empty}
    GROUP BY "clientId"`;
  const byId = new Map(sums.map((s) => [s.clientId, s]));
  return new Map(
    clients.map((c) => {
      const s = byId.get(c.id);
      return [c.id, decideState(c, Number(s?.balance ?? 0), Number(s?.overdue ?? 0), now)];
    }),
  );
}

export async function accountState(db: Db, clientId: string, now = new Date()): Promise<AccountState> {
  return (await accountStates(db, [clientId], now)).get(clientId)!;
}

/** Envíos de los últimos 7 días por cliente, para sugerir quién califica a crédito. */
export async function weeklyVolumes(db: Db, now = new Date()): Promise<Map<string, number>> {
  const rows = await db.order.groupBy({
    by: ["clientId"],
    where: { kind: "DELIVERY", createdAt: { gte: new Date(now.getTime() - 7 * 86400_000) }, status: { not: "CANCELLED" } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.clientId, r._count._all]));
}

export async function setCreditMode(prisma: PrismaClient, clientIds: string[], mode: CreditMode, actorUserId?: string) {
  const r = await prisma.client.updateMany({ where: { id: { in: clientIds } }, data: { creditMode: mode } });
  await audit(prisma, {
    actorUserId,
    action: "client.credit_mode",
    entity: "Client",
    entityId: clientIds.length === 1 ? clientIds[0] : undefined,
    summary: `${r.count} cliente(s) a ${mode === "WEEKLY_CREDIT" ? "crédito semanal" : "prepago"}`,
    data: { clientIds },
  });
  return r.count;
}

// ── Antigüedad de saldos [F11] ─────────────────────────────────────────────

export const AGING_BUCKETS = [
  { key: "d0_7", label: "0–7 días", max: 7 },
  { key: "d8_15", label: "8–15 días", max: 15 },
  { key: "d16_30", label: "16–30 días", max: 30 },
  { key: "d30", label: "Más de 30", max: Infinity },
] as const;
export type AgingRow = { clientId: string; total: number; buckets: Record<(typeof AGING_BUCKETS)[number]["key"], number>; oldest: Date | null };

/**
 * Reparte los abonos contra los cargos más antiguos (PEPS) y clasifica lo que queda sin pagar
 * por antigüedad. Solo clientes que deben.
 */
export function agingFromEntries(entries: { amount: number; createdAt: Date }[], now = new Date()) {
  let credit = -entries.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0);
  const charges = entries.filter((e) => e.amount > 0).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const buckets = { d0_7: 0, d8_15: 0, d16_30: 0, d30: 0 };
  let oldest: Date | null = null;
  for (const c of charges) {
    const paid = Math.min(credit, c.amount);
    credit -= paid;
    const open = c.amount - paid;
    if (open <= 0.005) continue;
    oldest ??= c.createdAt;
    const days = Math.floor((now.getTime() - c.createdAt.getTime()) / 86400_000);
    const b = AGING_BUCKETS.find((x) => days <= x.max)!;
    buckets[b.key] += open;
  }
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  return { total: Math.round(total * 100) / 100, buckets, oldest };
}

type OpenRow = { clientId: string; createdAt: Date; open: number; covered: boolean };

/** Cargos abiertos (PEPS) por cliente; `since` limita a movimientos recientes para ir rápido. */
async function openCharges(db: Db, since: Date | null, clientIds: string[] | null): Promise<OpenRow[]> {
  return db.$queryRaw<OpenRow[]>`
    WITH bal AS (
      SELECT "clientId", SUM(amount) AS b FROM "LedgerEntry"
      WHERE (${clientIds}::text[] IS NULL OR "clientId" = ANY(${clientIds}::text[]))
      GROUP BY "clientId" HAVING SUM(amount) > 0
    ), pos AS (
      SELECT e."clientId", e.amount, e."createdAt",
             SUM(e.amount) OVER (PARTITION BY e."clientId" ORDER BY e."createdAt" DESC, e.id DESC) AS run
      FROM "LedgerEntry" e JOIN bal ON bal."clientId" = e."clientId"
      WHERE e.amount > 0 AND (${since}::timestamp IS NULL OR e."createdAt" >= ${since}::timestamp)
    ), cov AS (
      SELECT "clientId", MAX(run) AS total FROM pos GROUP BY "clientId"
    )
    SELECT p."clientId", p."createdAt", LEAST(p.amount, bal.b - (p.run - p.amount))::float AS open, (cov.total >= bal.b) AS covered
    FROM pos p JOIN bal ON bal."clientId" = p."clientId" JOIN cov ON cov."clientId" = p."clientId"
    WHERE p.run - p.amount < bal.b`;
}

export async function agingReport(db: Db, now = new Date()): Promise<AgingRow[]> {
  // Con pagos aplicados a lo más viejo (PEPS), lo que se debe son los cargos más recientes que
  // suman el saldo. Primero se buscan en los últimos 45 días; solo los clientes con deuda más
  // vieja se revisan con todo su historial.
  const recent = await openCharges(db, new Date(now.getTime() - 45 * 86400_000), null);
  const uncovered = [...new Set(recent.filter((r) => !r.covered).map((r) => r.clientId))];
  const owingIds = (await db.ledgerEntry.groupBy({ by: ["clientId"], _sum: { amount: true }, having: { amount: { _sum: { gt: 0 } } } })).map((g) => g.clientId);
  const seen = new Set(recent.map((r) => r.clientId));
  const missing = owingIds.filter((id) => !seen.has(id)); // sin cargos recientes: toda su deuda es vieja
  const full = uncovered.length || missing.length ? await openCharges(db, null, [...uncovered, ...missing]) : [];
  const fullIds = new Set(full.map((r) => r.clientId));
  const rows = [...recent.filter((r) => !fullIds.has(r.clientId) && r.covered), ...full];
  const byClient = new Map<string, { amount: number; createdAt: Date }[]>();
  for (const r of rows) {
    const list = byClient.get(r.clientId) ?? [];
    list.push({ amount: Number(r.open), createdAt: r.createdAt });
    byClient.set(r.clientId, list);
  }
  return [...byClient.entries()]
    .map(([clientId, list]) => ({ clientId, ...agingFromEntries(list, now) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}
