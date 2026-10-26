// Tiempos esperados de ruta por repartidor [A26]: con OSRM se calcula cuánto debió tardar
// cada repartidor en entregar lo que entregó en el día (orden óptimo, ruta abierta desde la
// bodega, minutos fijos por parada) y se compara con lo que tardó en realidad.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { haversine, optimizeOrder, osrmMatrix, straightLineMatrix, type Matrix, type Point } from "./routing.ts";

type Db = Pick<PrismaClient, "$queryRaw">;

/** Bodega Packatelas (Plus Code CV85+VQ, col. Obrera): punto de salida de todas las rutas. */
export const DEPOT: Point = { lat: 19.4171875, lng: -99.1405625 };

export type RouteAnalysisOptions = {
  /** Minutos de servicio por parada. */
  serviceMinutes?: number;
  /** Solo cuentan entregas desde esta hora (CDMX)… */
  fromHour?: number;
  /** …y antes de esta. */
  toHour?: number;
  depot?: Point;
  osrmUrl?: string;
};

export type DayStop = { orderId: string; code: string; lat: number; lng: number; deliveredAt: Date; loadedAt: Date | null };

export type RouteDay = {
  driverId: string;
  driver: string;
  day: string; // YYYY-MM-DD (CDMX)
  stops: number;
  start: Date; // salida considerada
  firstDelivery: Date;
  lastDelivery: Date;
  driveMinutes: number; // manejo esperado en orden óptimo
  expectedMinutes: number; // manejo + servicio
  actualMinutes: number; // salida → última entrega
  method: "osrm" | "linea-recta";
  skippedNoLocation: number;
};

export type RouteDriverSummary = {
  driverId: string;
  driver: string;
  days: number;
  stops: number;
  expectedMinutes: number;
  actualMinutes: number;
  /** Real ÷ esperado (1 = tardó lo esperado; 1.3 = 30 % más). */
  ratio: number | null;
  perHour: number | null;
  extraMinutes: number; // minutos por encima de lo esperado (solo días que se excedió)
};

// Sin OSRM: distancia en línea recta × factor de calles ÷ velocidad promedio de moto en la ciudad.
const STREET_FACTOR = 1.35;
const SPEED_MPS = 22 / 3.6;

const ymdMx = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);
const atMx = (ymd: string, hour: number) => new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00-06:00`);

/** Costo del recorrido en el orden dado (segundos si la matriz es de tiempos). */
function pathCost(m: Matrix, order: number[]) {
  let c = 0;
  let prev = 0;
  for (const i of order) {
    c += m[prev][i + 1];
    prev = i + 1;
  }
  return c;
}

/** Minutos de manejo esperados para visitar `stops` en orden óptimo desde `depot`. */
export async function expectedDriveMinutes(depot: Point, stops: Point[], osrmUrl = process.env.OSRM_URL) {
  if (stops.length === 0) return { minutes: 0, method: "linea-recta" as const };
  const real = await osrmMatrix(depot, stops, osrmUrl);
  if (real) return { minutes: pathCost(real, optimizeOrder(real)) / 60, method: "osrm" as const };
  const m = straightLineMatrix(depot, stops);
  return { minutes: (pathCost(m, optimizeOrder(m)) * STREET_FACTOR) / SPEED_MPS / 60, method: "linea-recta" as const };
}

/** Analiza un día de un repartidor (función pura salvo la consulta a OSRM). */
export async function analyzeDay(
  driver: { driverId: string; driver: string; day: string },
  stops: DayStop[],
  o: Required<Pick<RouteAnalysisOptions, "serviceMinutes" | "fromHour">> & { depot: Point; osrmUrl?: string },
): Promise<RouteDay | null> {
  // Recolecciones/devoluciones internas: destino en la propia bodega.
  const real = stops.filter((s) => haversine(s, o.depot) > 150);
  if (real.length === 0) return null;
  const sorted = [...real].sort((a, b) => a.deliveredAt.getTime() - b.deliveredAt.getTime());
  const first = sorted[0].deliveredAt, last = sorted[sorted.length - 1].deliveredAt;
  // Salida: el último escaneo de carga antes de la primera entrega, nunca antes de la hora de inicio.
  const windowStart = atMx(driver.day, o.fromHour);
  const loads = sorted.map((s) => s.loadedAt).filter((d): d is Date => !!d && d < first && d > new Date(first.getTime() - 12 * 3600_000));
  const lastLoad = loads.length ? new Date(Math.max(...loads.map((d) => d.getTime()))) : null;
  const start = lastLoad && lastLoad > windowStart ? lastLoad : windowStart;
  const drive = await expectedDriveMinutes(o.depot, sorted, o.osrmUrl);
  const expected = drive.minutes + o.serviceMinutes * sorted.length;
  return {
    ...driver,
    stops: sorted.length,
    start,
    firstDelivery: first,
    lastDelivery: last,
    driveMinutes: Math.round(drive.minutes),
    expectedMinutes: Math.round(expected),
    actualMinutes: Math.max(0, Math.round((last.getTime() - start.getTime()) / 60000)),
    method: drive.method,
    skippedNoLocation: 0,
  };
}

export function summarize(days: RouteDay[]): RouteDriverSummary[] {
  const by = new Map<string, RouteDay[]>();
  for (const d of days) by.set(d.driverId, [...(by.get(d.driverId) ?? []), d]);
  return [...by.values()]
    .map((ds) => {
      const expectedMinutes = ds.reduce((s, d) => s + d.expectedMinutes, 0);
      const actualMinutes = ds.reduce((s, d) => s + d.actualMinutes, 0);
      const stops = ds.reduce((s, d) => s + d.stops, 0);
      return {
        driverId: ds[0].driverId,
        driver: ds[0].driver,
        days: ds.length,
        stops,
        expectedMinutes,
        actualMinutes,
        ratio: expectedMinutes ? Math.round((actualMinutes / expectedMinutes) * 100) / 100 : null,
        perHour: actualMinutes ? Math.round((stops / (actualMinutes / 60)) * 10) / 10 : null,
        extraMinutes: ds.reduce((s, d) => s + Math.max(0, d.actualMinutes - d.expectedMinutes), 0),
      };
    })
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
}

/** Entregas del periodo agrupadas por repartidor (quien marcó la entrega) y día, con su análisis. */
export async function routeAnalysis(db: Db, range: { from: Date; to: Date }, opts: RouteAnalysisOptions = {}) {
  const o = { serviceMinutes: opts.serviceMinutes ?? 10, fromHour: opts.fromHour ?? 15, toHour: opts.toHour ?? 23, depot: opts.depot ?? DEPOT, osrmUrl: opts.osrmUrl };
  const rows = await db.$queryRaw<
    { orderId: string; code: string; lat: number | null; lng: number | null; at: Date; driverId: string; name: string; loadedAt: Date | null }[]
  >`
    SELECT o.id AS "orderId", o.code, o.lat, o.lng, e."occurredAt" AS at, d.id AS "driverId", u.name,
      (SELECT MAX(l."occurredAt") FROM "OrderEvent" l WHERE l."orderId" = o.id AND l.type = 'scanned_loaded' AND l."occurredAt" <= e."occurredAt") AS "loadedAt"
    FROM "OrderEvent" e
    JOIN "Order" o ON o.id = e."orderId"
    JOIN "User" u ON u.id = e."actorUserId"
    JOIN "Driver" d ON d."userId" = u.id
    WHERE e.type = 'delivered' AND e."occurredAt" >= ${range.from} AND e."occurredAt" < ${range.to}
      AND EXTRACT(HOUR FROM (e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City') >= ${o.fromHour}
      AND EXTRACT(HOUR FROM (e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City') < ${o.toHour}
      AND o.code NOT ILIKE '%RECOLECCION%'
    ORDER BY e."occurredAt"`;

  // Una entrega por pedido (la primera), agrupada por repartidor y día.
  const seen = new Set<string>();
  const groups = new Map<string, { driverId: string; driver: string; day: string; stops: DayStop[]; noLoc: number }>();
  for (const r of rows) {
    if (seen.has(r.orderId)) continue;
    seen.add(r.orderId);
    const day = ymdMx(r.at);
    const key = `${r.driverId}|${day}`;
    const g = groups.get(key) ?? { driverId: r.driverId, driver: r.name, day, stops: [], noLoc: 0 };
    if (r.lat == null || r.lng == null) g.noLoc++;
    else g.stops.push({ orderId: r.orderId, code: r.code, lat: r.lat, lng: r.lng, deliveredAt: r.at, loadedAt: r.loadedAt });
    groups.set(key, g);
  }

  // Pocas consultas a OSRM en paralelo para no saturarlo.
  const list = [...groups.values()];
  const days: RouteDay[] = [];
  for (let i = 0; i < list.length; i += 4) {
    const batch = await Promise.all(
      list.slice(i, i + 4).map(async (g) => {
        const d = await analyzeDay(g, g.stops, o);
        return d ? { ...d, skippedNoLocation: g.noLoc } : null;
      }),
    );
    days.push(...batch.filter((d): d is RouteDay => d !== null));
  }
  days.sort((a, b) => a.day.localeCompare(b.day) || a.driver.localeCompare(b.driver));
  return { days, drivers: summarize(days), options: o, method: days.some((d) => d.method === "linea-recta") ? "linea-recta" : "osrm" };
}
