// Salud de la API de MercadoLibre: ¿nos llegan los avisos, la cola avanza, ML responde (o nos
// limita por intentos) y los estados guardados coinciden con los de ML en vivo?
// Solo lectura hacia ML: únicamente consultas GET.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { enqueueMlJob, mlAccessToken } from "./ml-api.ts";
import { IN_ROUTE } from "./dispatch.ts";

type Fetch = typeof fetch;
const API = "https://api.mercadolibre.com";
const MIN = 60_000;

/** Inicio del día de hoy en CDMX. */
export function startOfTodayMx(now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(now);
  return new Date(`${ymd}T00:00:00-06:00`);
}

const NOTIF_KEY = "ml.notif.stats";
type NotifStats = { lastAt: string; buckets: Record<string, number> };
const hourKey = (d: Date) => d.toISOString().slice(0, 13);

/** Cuenta cada aviso que manda ML (por hora, últimas 24) para saber si siguen llegando. */
export async function countMlNotification(prisma: PrismaClient, now = new Date()) {
  const row = await prisma.setting.findUnique({ where: { key: NOTIF_KEY } });
  const prev = (row?.value as NotifStats | undefined) ?? { lastAt: "", buckets: {} };
  const k = hourKey(now);
  const keep = new Set(Array.from({ length: 24 }, (_, i) => hourKey(new Date(now.getTime() - i * 3600_000))));
  const buckets = Object.fromEntries(Object.entries(prev.buckets).filter(([h]) => keep.has(h)));
  buckets[k] = (buckets[k] ?? 0) + 1;
  const value = { lastAt: now.toISOString(), buckets };
  await prisma.setting.upsert({ where: { key: NOTIF_KEY }, update: { value }, create: { key: NOTIF_KEY, value } });
}

export async function mlNotificationStats(prisma: PrismaClient, now = new Date()) {
  const row = await prisma.setting.findUnique({ where: { key: NOTIF_KEY } });
  const s = (row?.value as NotifStats | undefined) ?? { lastAt: "", buckets: {} };
  const hours = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getTime() - (23 - i) * 3600_000);
    return { hour: d, count: s.buckets[hourKey(d)] ?? 0 };
  });
  return { lastAt: s.lastAt ? new Date(s.lastAt) : null, hours, total24: hours.reduce((a, h) => a + h.count, 0) };
}

/** Avisos recibidos y estado de la cola (sin llamar a ML). */
export async function mlQueueHealth(prisma: PrismaClient, now = new Date()) {
  const t = now.getTime();
  const [last15, last60, last24h, lastJob, pending, overdue, failed24, errors] = await Promise.all([
    prisma.mlJob.count({ where: { updatedAt: { gte: new Date(t - 15 * MIN) } } }),
    prisma.mlJob.count({ where: { updatedAt: { gte: new Date(t - 60 * MIN) } } }),
    prisma.mlJob.count({ where: { updatedAt: { gte: new Date(t - 1440 * MIN) } } }),
    prisma.mlJob.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.mlJob.count({ where: { status: "PENDING" } }),
    prisma.mlJob.count({ where: { status: "PENDING", runAfter: { lt: new Date(t - 2 * MIN) } } }),
    prisma.mlJob.count({ where: { status: "FAILED", updatedAt: { gte: new Date(t - 1440 * MIN) } } }),
    prisma.mlJob.groupBy({
      by: ["lastError"],
      where: { attempts: { gt: 0 }, lastError: { not: null }, updatedAt: { gte: new Date(t - 1440 * MIN) } },
      _count: { _all: true },
      orderBy: { _count: { lastError: "desc" } },
      take: 6,
    }),
  ]);
  return {
    jobs: { last15, last60, last24h, lastAt: lastJob?.updatedAt ?? null },
    pending,
    overdue,
    failed24,
    errors: errors.map((e) => ({ error: e.lastError ?? "", count: e._count._all })),
  };
}

export type ProbeRow = {
  orderId: string;
  code: string;
  driver: string | null;
  ours: string; // estado en Packatelas
  stored: string | null; // estado ML guardado
  live: string | null; // estado ML en vivo
  liveSub: string | null;
  http: number; // 0 = sin respuesta
  ms: number;
  verdict: "ok" | "desfasado" | "solo_app" | "solo_ml" | "pendiente" | "error";
};

/** Pedidos ML de hoy que vale la pena revisar: en ruta, o entregados/fallidos hoy en la app. */
async function todaysMlOrders(prisma: PrismaClient, limit: number, now: Date) {
  const since = startOfTodayMx(now);
  return prisma.order.findMany({
    where: {
      mlShipmentId: { not: null },
      mlAccountId: { not: null },
      OR: [{ status: { in: IN_ROUTE } }, { status: { in: ["DELIVERED", "FAILED", "RESCHEDULED"] }, updatedAt: { gte: since } }],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true, code: true, status: true, mlStatus: true, mlSubstatus: true, mlShipmentId: true, mlAccountId: true,
      driver: { select: { user: { select: { name: true } } } },
    },
  });
}

/**
 * Prueba en vivo: consulta a ML el estado de los pedidos de hoy (hasta `limit`) y lo compara con
 * lo guardado y con lo que marcó el repartidor en la app. Mide tiempos y detecta límites (429).
 */
export async function mlLiveProbe(prisma: PrismaClient, opts: { limit?: number; fetchImpl?: Fetch; now?: Date; resync?: boolean } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const orders = await todaysMlOrders(prisma, opts.limit ?? 60, now);
  const tokens = new Map<string, Promise<string | null>>();
  const token = (accountId: string) => {
    if (!tokens.has(accountId)) tokens.set(accountId, mlAccessToken(prisma, accountId, fetchImpl).catch(() => null));
    return tokens.get(accountId)!;
  };

  const rows: ProbeRow[] = [];
  let rateLimited = 0;
  const queue = [...orders];
  const worker = async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      const base = { orderId: o.id, code: o.code, driver: o.driver?.user.name ?? null, ours: o.status, stored: o.mlStatus };
      const tk = await token(o.mlAccountId!);
      if (!tk) {
        rows.push({ ...base, live: null, liveSub: null, http: 401, ms: 0, verdict: "error" });
        continue;
      }
      const t0 = Date.now();
      let http = 0, live: string | null = null, liveSub: string | null = null;
      try {
        const res = await fetchImpl(`${API}/shipments/${o.mlShipmentId}`, { headers: { Authorization: `Bearer ${tk}`, "x-format-new": "true" }, signal: AbortSignal.timeout(15_000) });
        http = res.status;
        if (res.status === 429) rateLimited++;
        if (res.ok) {
          const j = (await res.json()) as { status?: string; substatus?: string | null };
          live = j.status ?? null;
          liveSub = j.substatus ?? null;
        }
      } catch {
        http = 0;
      }
      const ms = Date.now() - t0;
      let verdict: ProbeRow["verdict"];
      if (!live) verdict = "error";
      else if (live !== o.mlStatus || (liveSub ?? null) !== (o.mlSubstatus ?? null)) verdict = "desfasado";
      else if (o.status === "DELIVERED" && live !== "delivered") verdict = "solo_app";
      else if (live === "delivered" && o.status !== "DELIVERED") verdict = "solo_ml";
      else if (live === "delivered" || o.status === "DELIVERED") verdict = "ok";
      else verdict = "pendiente";
      rows.push({ ...base, live, liveSub, http, ms, verdict });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // Los desfasados se vuelven a sincronizar por la cola normal.
  if (opts.resync) {
    for (const r of rows.filter((x) => x.verdict === "desfasado")) {
      const o = orders.find((x) => x.id === r.orderId)!;
      await enqueueMlJob(prisma, { topic: "shipments", resource: `/shipments/${o.mlShipmentId}` }).catch(() => {});
    }
  }

  const ok = rows.filter((r) => r.http >= 200 && r.http < 300);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(p * times.length))] : 0);
  const byHttp: Record<string, number> = {};
  for (const r of rows) {
    const k = r.http ? String(r.http) : "sin respuesta";
    byHttp[k] = (byHttp[k] ?? 0) + 1;
  }
  const count = (v: ProbeRow["verdict"]) => rows.filter((r) => r.verdict === v).length;

  // Por repartidor: lo que marcó en la app vs lo que ML dice entregado.
  const drivers = new Map<string, { name: string; total: number; appDelivered: number; mlDelivered: number; soloApp: number; enRuta: number }>();
  for (const r of rows) {
    const k = r.driver ?? "Sin repartidor";
    const d = drivers.get(k) ?? { name: k, total: 0, appDelivered: 0, mlDelivered: 0, soloApp: 0, enRuta: 0 };
    d.total++;
    if (r.ours === "DELIVERED") d.appDelivered++;
    if (r.live === "delivered") d.mlDelivered++;
    if (r.verdict === "solo_app") d.soloApp++;
    if ((IN_ROUTE as string[]).includes(r.ours) && r.live !== "delivered") d.enRuta++;
    drivers.set(k, d);
  }

  return {
    at: now,
    checked: rows.length,
    answered: ok.length,
    rateLimited,
    byHttp,
    p50: pct(0.5),
    p95: pct(0.95),
    verdicts: { ok: count("ok"), desfasado: count("desfasado"), solo_app: count("solo_app"), solo_ml: count("solo_ml"), pendiente: count("pendiente"), error: count("error") },
    drivers: [...drivers.values()].sort((a, b) => b.total - a.total),
    rows: rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.code.localeCompare(b.code)),
  };
}

/**
 * Respaldo por si los avisos de ML se atrasan: vuelve a encolar los pedidos ML en ruta (o
 * cerrados hoy en la app sin «entregado» en ML) cuya última sincronización tiene más de `minutes`.
 */
export async function requeueStaleMlOrders(prisma: PrismaClient, opts: { minutes?: number; limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.minutes ?? 20) * MIN);
  const orders = await prisma.order.findMany({
    where: {
      mlShipmentId: { not: null },
      mlAccountId: { not: null },
      mlStatus: { notIn: ["delivered", "cancelled"] },
      OR: [{ status: { in: IN_ROUTE } }, { status: "DELIVERED", updatedAt: { gte: startOfTodayMx(now) } }],
    },
    select: { mlShipmentId: true },
    take: 2000,
  });
  if (!orders.length) return 0;
  const keys = orders.map((o) => `shipment:${o.mlShipmentId}`);
  const fresh = new Set(
    (await prisma.mlJob.findMany({ where: { key: { in: keys }, OR: [{ updatedAt: { gte: cutoff } }, { status: "PENDING" }] }, select: { key: true } })).map((j) => j.key),
  );
  let n = 0;
  for (const o of orders) {
    if (n >= (opts.limit ?? 150)) break;
    if (fresh.has(`shipment:${o.mlShipmentId}`)) continue;
    await enqueueMlJob(prisma, { topic: "shipments", resource: `/shipments/${o.mlShipmentId}` });
    n++;
  }
  return n;
}
