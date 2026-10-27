// Alertas al administrador [A20]: aviso al teléfono (push y app Android) cuando algo de
// Salud operativa deja de estar bien, y otro cuando se resuelve. Evita el ruido: se avisa
// después de verlo dos revisiones seguidas, se recuerda cada 6 h y no se repite lo mismo.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { driversWithoutLocation } from "./failures.ts";
import { readHealth, type HealthEntry } from "./notifications.ts";
import { adminUserIds, sendPush } from "./push.ts";

export type Alert = { key: string; title: string; body: string; url?: string; value?: number };
type State = Record<string, { since: string; seen: number; notifiedAt?: string; value?: number }>;

const REMIND_MS = 6 * 3600_000;

const minutesAgo = (h: HealthEntry | undefined, now: number) => (h ? (now - new Date(h.at).getTime()) / 60_000 : Infinity);

/** Problemas actuales (todo lo que revisa el proceso en segundo plano, menos su propio latido). */
export async function evaluateAlerts(prisma: PrismaClient, opts: { now?: Date; osrmOk?: boolean | null } = {}): Promise<Alert[]> {
  const now = (opts.now ?? new Date()).getTime();
  const [h, lost, unidentified, waFailed, mlBad] = await Promise.all([
    readHealth(prisma),
    driversWithoutLocation(prisma, 15, new Date(now)),
    prisma.payment.count({ where: { status: "UNIDENTIFIED" } }),
    prisma.notification.count({ where: { status: "FAILED", createdAt: { gte: new Date(now - 3600_000) } } }),
    prisma.mlAccount.count({ where: { status: "REVOKED" } }),
  ]);
  const out: Alert[] = [];
  const g = h.gmail;
  if (g && !g.detail?.startsWith("Sin autorizar") && (!g.ok || minutesAgo(g, now) > 20)) {
    out.push({ key: "gmail", title: "Depósitos: no se está leyendo Gmail", body: g.ok ? "Hace más de 20 min que no se revisa el correo de Fondeadora" : (g.detail ?? "Error al leer el correo"), url: "/admin/salud" });
  }
  if (h.tareas && minutesAgo(h.tareas, now) > 150) {
    out.push({ key: "tareas", title: "Tareas programadas detenidas", body: "Bloqueos por adeudo y recordatorios no corren desde hace más de 2 h", url: "/admin/salud" });
  }
  if (waFailed >= 3) out.push({ key: "whatsapp", title: "WhatsApp: avisos fallando", body: `${waFailed} avisos fallaron en la última hora`, url: "/admin/avisos", value: waFailed });
  const hrs = Number(/hace (\d+) h/.exec(h.respaldos?.detail ?? "")?.[1] ?? NaN);
  if (h.respaldos && (h.respaldos.detail?.startsWith("Aún no hay") || hrs > 30)) {
    out.push({ key: "respaldos", title: "Respaldo de la base atrasado", body: h.respaldos.detail ?? "Sin respaldo reciente", url: "/admin/salud" });
  }
  if (opts.osrmOk === false) out.push({ key: "osrm", title: "Rutas sin mapa de calles", body: "OSRM no responde; las rutas se ordenan en línea recta", url: "/admin/salud" });
  if (lost.length) {
    out.push({ key: "ubicacion", title: "Repartidores sin ubicación", body: `${lost.map((d) => d.user.name).join(", ")}: en turno sin reportar ubicación`, url: "/admin/despacho", value: lost.length });
  }
  if (unidentified) out.push({ key: "pagos", title: "Pagos sin identificar", body: `${unidentified} depósito(s) esperan que elijas el cliente`, url: "/admin/cobros", value: unidentified });
  if (mlBad) out.push({ key: "ml", title: "MercadoLibre: cuentas revocadas", body: `${mlBad} cuenta(s) quitaron el permiso a Packatelas`, url: "/admin/clientes", value: mlBad });
  return out;
}

/**
 * Compara con lo avisado antes y manda los avisos que tocan. Cada revisor guarda su propio
 * estado (`checker`): el worker revisa todo menos su latido; la web revisa solo ese latido.
 * Devuelve lo que se avisó.
 */
export async function syncAlerts(prisma: PrismaClient, active: Alert[], checker: string, send = sendPush, now = new Date()) {
  const key = `alerts.${checker}`;
  const row = await prisma.setting.findUnique({ where: { key } });
  const state: State = (row?.value as State | undefined) ?? {};
  const sent: string[] = [];
  const msgs: { title: string; body: string; url?: string; tag: string }[] = [];

  for (const a of active) {
    const s = state[a.key] ?? { since: now.toISOString(), seen: 0 };
    s.seen += 1;
    const grew = a.value != null && s.value != null && a.value > s.value;
    const remind = s.notifiedAt && now.getTime() - new Date(s.notifiedAt).getTime() > REMIND_MS;
    // Pagos nuevos sin identificar se avisan de inmediato; lo demás tras dos revisiones seguidas.
    const ready = a.key === "pagos" ? true : s.seen >= 2;
    if (ready && (!s.notifiedAt || remind || grew)) {
      msgs.push({ title: a.title, body: a.body, url: a.url, tag: `alerta-${a.key}` });
      s.notifiedAt = now.toISOString();
      sent.push(a.key);
    }
    s.value = a.value;
    state[a.key] = s;
  }
  for (const k of Object.keys(state)) {
    if (active.some((a) => a.key === k)) continue;
    if (state[k].notifiedAt && k !== "pagos") {
      msgs.push({ title: "Resuelto", body: `Ya está bien: ${LABELS[k] ?? k}`, url: "/admin/salud", tag: `alerta-${k}` });
      sent.push(`${k}:ok`);
    }
    delete state[k];
  }
  await prisma.setting.upsert({ where: { key }, update: { value: state }, create: { key, value: state } });
  if (msgs.length) {
    const admins = await adminUserIds(prisma);
    for (const m of msgs) await send(prisma, admins, m);
  }
  return sent;
}

const LABELS: Record<string, string> = {
  gmail: "lectura de depósitos en Gmail",
  tareas: "tareas programadas",
  whatsapp: "avisos por WhatsApp",
  respaldos: "respaldo de la base",
  osrm: "mapa de calles (OSRM)",
  ubicacion: "ubicación de los repartidores",
  ml: "cuentas de MercadoLibre",
  worker: "proceso en segundo plano",
};

/** Latido del worker (lo revisa la web, porque el worker no puede avisar si está caído). */
export async function workerAlert(prisma: PrismaClient, now = new Date()): Promise<Alert[]> {
  const h = (await readHealth(prisma)).worker;
  if (h && minutesAgo(h, now.getTime()) <= 10) return [];
  return [{ key: "worker", title: "Proceso en segundo plano detenido", body: "No reporta desde hace más de 10 min: depósitos, avisos y tareas no están corriendo. Revisa el servicio worker en Coolify.", url: "/admin/salud" }];
}
