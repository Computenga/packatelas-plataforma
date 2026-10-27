// Informes operativos [A17] y carga quemada [A18]. Fechas en hora de la Ciudad de México.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

type Db = PrismaClient | Prisma.TransactionClient;
export type Range = { from: Date; to: Date }; // [from, to)

/** Meta de equilibrio: entregas por repartidor al día para cubrir costos. */
export const BREAK_EVEN_PER_DAY = 15;

export type DriverReport = {
  driverId: string; name: string; delivered: number; failed: number; days: number; perDay: number;
  effectiveness: number; overtime: number; afterHours: number; avgMinutes: number | null;
};

/**
 * Por repartidor: entregas y fallidos registrados por él en el periodo, días trabajados,
 * entregas en horario extra (19–23 h) y fuera de horario (23 h o después, no cuentan),
 * y minutos promedio desde que cargó el paquete hasta entregarlo.
 */
export async function driverReport(db: Db, r: Range): Promise<DriverReport[]> {
  const rows = await db.$queryRaw<
    { driverId: string; name: string; delivered: bigint; failed: bigint; days: bigint; overtime: bigint; afterHours: bigint; avgMinutes: number | null }[]
  >`
    WITH ev AS (
      SELECT e."orderId", e.type, e."occurredAt", d.id AS "driverId", u.name,
             ((e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City') AS local
      FROM "OrderEvent" e
      JOIN "User" u ON u.id = e."actorUserId"
      JOIN "Driver" d ON d."userId" = u.id
      WHERE e.type IN ('delivered', 'failed') AND e."occurredAt" >= ${r.from} AND e."occurredAt" < ${r.to}
    ),
    load AS (
      SELECT "orderId", MAX("occurredAt") AS at FROM "OrderEvent"
      WHERE type = 'scanned_loaded' AND "occurredAt" < ${r.to} GROUP BY "orderId"
    )
    SELECT ev."driverId", ev.name,
      COUNT(*) FILTER (WHERE ev.type = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE ev.type = 'failed') AS failed,
      COUNT(DISTINCT ev.local::date) AS days,
      COUNT(*) FILTER (WHERE ev.type = 'delivered' AND EXTRACT(HOUR FROM ev.local) BETWEEN 19 AND 22) AS overtime,
      COUNT(*) FILTER (WHERE ev.type = 'delivered' AND EXTRACT(HOUR FROM ev.local) >= 23) AS "afterHours",
      AVG(EXTRACT(EPOCH FROM ev."occurredAt" - load.at) / 60) FILTER (
        WHERE ev.type = 'delivered' AND load.at IS NOT NULL AND ev."occurredAt" - load.at BETWEEN interval '0' AND interval '16 hours'
      )::float AS "avgMinutes"
    FROM ev LEFT JOIN load ON load."orderId" = ev."orderId"
    GROUP BY ev."driverId", ev.name
    ORDER BY delivered DESC`;
  return rows.map((x) => {
    const delivered = Number(x.delivered), failed = Number(x.failed), days = Number(x.days);
    return {
      driverId: x.driverId, name: x.name, delivered, failed, days,
      perDay: days ? Math.round((delivered / days) * 10) / 10 : 0,
      effectiveness: delivered + failed ? Math.round((delivered / (delivered + failed)) * 100) : 0,
      overtime: Number(x.overtime), afterHours: Number(x.afterHours),
      avgMinutes: x.avgMinutes == null ? null : Math.round(x.avgMinutes),
    };
  });
}

export type ClientReport = {
  clientId: string; name: string; publicId: string; created: number; delivered: number; failedAttempts: number;
  returned: number; charged: number;
};

/** Por cliente: envíos registrados en el periodo y cómo terminaron; cargos del periodo. */
export async function clientReport(db: Db, r: Range): Promise<ClientReport[]> {
  const rows = await db.$queryRaw<
    { clientId: string; name: string; publicId: string; created: bigint; delivered: bigint; failedAttempts: bigint; returned: bigint; charged: Prisma.Decimal | null }[]
  >`
    SELECT c.id AS "clientId", c.name, c."publicId",
      COUNT(o.id) AS created,
      COUNT(o.id) FILTER (WHERE o.status = 'DELIVERED') AS delivered,
      COALESCE(SUM(o.attempts) FILTER (WHERE o.status <> 'DELIVERED'), 0) + COALESCE(SUM(GREATEST(o.attempts - 1, 0)) FILTER (WHERE o.status = 'DELIVERED'), 0) AS "failedAttempts",
      COUNT(o.id) FILTER (WHERE o.status IN ('RETURNING', 'RETURNED_TO_WAREHOUSE', 'RETURNED_TO_SELLER')) AS returned,
      (SELECT SUM(l.amount) FROM "LedgerEntry" l WHERE l."clientId" = c.id AND l.type IN ('CHARGE', 'FEE') AND l."createdAt" >= ${r.from} AND l."createdAt" < ${r.to}) AS charged
    FROM "Client" c
    JOIN "Order" o ON o."clientId" = c.id AND o."createdAt" >= ${r.from} AND o."createdAt" < ${r.to} AND o.status <> 'CANCELLED'
    GROUP BY c.id
    ORDER BY created DESC`;
  return rows.map((x) => ({
    clientId: x.clientId, name: x.name, publicId: x.publicId, created: Number(x.created), delivered: Number(x.delivered),
    failedAttempts: Number(x.failedAttempts), returned: Number(x.returned), charged: Number(x.charged ?? 0),
  }));
}

export type ZoneReport = { zone: string; created: number; delivered: number; failed: number; effectiveness: number };

/** Por zona (alcaldía/municipio, o CP): volumen y efectividad. */
export async function zoneReport(db: Db, r: Range, by: "city" | "zip" = "city"): Promise<ZoneReport[]> {
  const col = by === "zip" ? Prisma.sql`COALESCE(NULLIF(o.zip, ''), 'Sin CP')` : Prisma.sql`COALESCE(NULLIF(INITCAP(TRIM(o.city)), ''), 'Sin alcaldía')`;
  const rows = await db.$queryRaw<{ zone: string; created: bigint; delivered: bigint; failed: bigint }[]>`
    SELECT ${col} AS zone, COUNT(*) AS created,
      COUNT(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered,
      COUNT(*) FILTER (WHERE o.attempts > 0 AND o.status <> 'DELIVERED') AS failed
    FROM "Order" o
    WHERE o."createdAt" >= ${r.from} AND o."createdAt" < ${r.to} AND o.status <> 'CANCELLED'
      AND o."addressLine" <> 'Pendiente de sincronizar con MercadoLibre'
    GROUP BY 1 ORDER BY created DESC LIMIT 300`;
  return rows.map((x) => {
    const delivered = Number(x.delivered), failed = Number(x.failed);
    return { zone: x.zone, created: Number(x.created), delivered, failed, effectiveness: delivered + failed ? Math.round((delivered / (delivered + failed)) * 100) : 0 };
  });
}

/** Entregas por hora del día (hora CDMX). */
export async function deliveriesByHour(db: Db, r: Range): Promise<number[]> {
  const rows = await db.$queryRaw<{ h: number; n: bigint }[]>`
    SELECT EXTRACT(HOUR FROM ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City')::int AS h, COUNT(*) AS n
    FROM "OrderEvent" WHERE type = 'delivered' AND "occurredAt" >= ${r.from} AND "occurredAt" < ${r.to}
    GROUP BY 1`;
  const out = new Array(24).fill(0);
  for (const x of rows) out[x.h] = Number(x.n);
  return out;
}

/** Puntos de entrega para el mapa de calor (máx. 5,000). */
export async function deliveryPoints(db: Db, r: Range): Promise<[number, number][]> {
  const rows = await db.order.findMany({
    where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to }, lat: { not: null }, lng: { not: null } },
    select: { lat: true, lng: true },
    take: 5000,
    orderBy: { deliveredAt: "desc" },
  });
  return rows.map((o) => [o.lng!, o.lat!]);
}

// ── Carga quemada [A18] ──────────────────────────────────────────────────

export type BurnedRow = {
  id: string; code: string; client: string; publicId: string; createdAt: Date; promisedAt: Date; deliveredAt: Date | null;
  status: string; kind: "llego_quemada" | "entrega_tarde" | "vencida";
};

const YMD_MX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const ymdMx = (d: Date) => YMD_MX.format(d);

/**
 * Clasifica pedidos con fecha compromiso:
 * - llegó quemada: la fecha compromiso es anterior al día en que la recibimos (no es culpa de Packatelas);
 * - entrega tarde: se recibió a tiempo pero se entregó después del día compromiso;
 * - vencida: se recibió a tiempo, sigue sin entregarse y ya pasó el día compromiso.
 */
export function classifyBurned(o: { createdAt: Date; requestedDeliveryAt: Date; deliveredAt: Date | null; status: string }, now = new Date()): BurnedRow["kind"] | null {
  const promised = ymdMx(o.requestedDeliveryAt);
  if (promised < ymdMx(o.createdAt)) return "llego_quemada";
  if (o.deliveredAt) return ymdMx(o.deliveredAt) > promised ? "entrega_tarde" : null;
  if (["CANCELLED", "RETURNED_TO_SELLER"].includes(o.status)) return null;
  return ymdMx(now) > promised ? "vencida" : null;
}

export async function burnedReport(db: Db, r: Range, now = new Date()): Promise<BurnedRow[]> {
  const orders = await db.order.findMany({
    where: { createdAt: { gte: r.from, lt: r.to }, requestedDeliveryAt: { not: null } },
    select: { id: true, code: true, createdAt: true, requestedDeliveryAt: true, deliveredAt: true, status: true, client: { select: { name: true, publicId: true } } },
    orderBy: { createdAt: "desc" },
    take: 20000,
  });
  const out: BurnedRow[] = [];
  for (const o of orders) {
    const kind = classifyBurned({ ...o, requestedDeliveryAt: o.requestedDeliveryAt! }, now);
    if (kind) out.push({ id: o.id, code: o.code, client: o.client.name, publicId: o.client.publicId, createdAt: o.createdAt, promisedAt: o.requestedDeliveryAt!, deliveredAt: o.deliveredAt, status: o.status, kind });
  }
  return out;
}
