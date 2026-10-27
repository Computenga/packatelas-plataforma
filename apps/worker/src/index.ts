// Proceso en segundo plano: revisa Gmail y aplica los depósitos de Fondeadora [F04, I03].
import "dotenv/config";
import { dailyCleanup, evaluateAlerts, syncAlerts, processWebhooks, deliverPending, getCreditRules, ingestFondeadoraEmail, mlConfig, prisma, processMlJobs, refreshAllBlockedPickups, reportHealth, sendWeeklyReminders } from "@packatelas/db";
import { whatsappSender } from "./whatsapp.ts";
import { startBackups } from "./backups.ts";
import { shrinkOldPhotos } from "./photos.ts";
import { getMessage, listMessageIds, type GmailConfig } from "./gmail.ts";

const QUERY = process.env.GMAIL_QUERY ?? 'from:info@negocios.fondeadora.com subject:"Depósito" newer_than:3d';
const EVERY_MS = Math.max(30, Number(process.env.GMAIL_POLL_SECONDS ?? 120)) * 1000;

function config(): GmailConfig | null {
  const { GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret, GMAIL_REFRESH_TOKEN: refreshToken } = process.env;
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

export async function pollOnce(cfg: GmailConfig) {
  const ids = await listMessageIds(cfg, QUERY);
  if (!ids.length) return { seen: 0, applied: 0, unidentified: 0 };
  // Solo los correos que aún no se han procesado
  const done = new Set(
    (await prisma.payment.findMany({ where: { externalId: { in: ids } }, select: { externalId: true } })).map((p) => p.externalId),
  );
  let applied = 0;
  let unidentified = 0;
  for (const id of ids.filter((i) => !done.has(i))) {
    const msg = await getMessage(cfg, id);
    const r = await ingestFondeadoraEmail(prisma, { externalId: msg.id, receivedAt: msg.receivedAt, text: msg.text, authentic: msg.authentic });
    if (r.status === "applied") applied++;
    if (r.status === "unidentified") unidentified++;
  }
  return { seen: ids.length, applied, unidentified };
}

const DAYS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Cada hora: bloqueos de recolección (el lunes, crédito sin liquidar) [F08] y recordatorios de pago [F10]. */
function startHourlyJobs() {
  const run = async () => {
    try {
      const n = await refreshAllBlockedPickups(prisma);
      if (n) console.log(`[worker] Bloqueos de recolección revisados (${n} cliente(s))`);
      const rules = await getCreditRules(prisma);
      const r = await sendWeeklyReminders(prisma, new Date(), DAYS[rules.cutWeekday]);
      if (r) console.log(`[worker] ${r} recordatorio(s) de pago en cola`);
      await reportHealth(prisma, "tareas", true, `Bloqueos revisados: ${n}; recordatorios: ${r}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[worker] Error en tareas por hora:", msg);
      await reportHealth(prisma, "tareas", false, msg).catch(() => {});
    }
  };
  void run();
  setInterval(run, 3600_000);
}

/** Cada 30 s: envía los avisos pendientes por WhatsApp [I04]. Cada minuto: latido. */
function startNotifier() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    const sender = whatsappSender();
    try {
      const r = await deliverPending(prisma, sender);
      if (r.sent || r.failed) console.log(`[worker] Avisos: ${r.sent} enviados, ${r.failed} fallidos`);
      await reportHealth(prisma, "whatsapp", !!sender && !r.failed, sender ? `Últimos: ${r.sent} enviados, ${r.failed} fallidos` : "Sin credenciales (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID)");
    } catch (e) {
      await reportHealth(prisma, "whatsapp", false, e instanceof Error ? e.message : String(e)).catch(() => {});
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 30_000);
  const beat = () => reportHealth(prisma, "worker", true).catch(() => {});
  void beat();
  setInterval(beat, 60_000);
}

/** Cada 15 s: trae de MercadoLibre los envíos escaneados o notificados [A01, A12]. */
function startMlSync() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!mlConfig()) {
        await reportHealth(prisma, "mercadolibre", false, "Sin configurar (ML_CLIENT_ID, ML_CLIENT_SECRET, PUBLIC_URL)");
        return;
      }
      const r = await processMlJobs(prisma);
      if (r.seen) console.log(`[worker] MercadoLibre: ${r.done} sincronizados, ${r.failed} con error`);
      await reportHealth(prisma, "mercadolibre", r.failed === 0, `Última vuelta: ${r.done} sincronizados, ${r.failed} con error`);
    } catch (e) {
      await reportHealth(prisma, "mercadolibre", false, e instanceof Error ? e.message : String(e)).catch(() => {});
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(tick, 15_000);
}

/** Webhooks de estado a sistemas de clientes [I08], cada 15 s. */
function startWebhooks() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await processWebhooks(prisma);
      if (r.sent || r.failed) console.log(`[worker] Webhooks: ${r.sent} enviados, ${r.failed} con error`);
    } catch (e) {
      console.error("[worker] Webhooks:", e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  }, 15_000);
}

/** Cada 5 min: alertas al administrador cuando algo de Salud operativa falla [A20]. */
function startAlerts() {
  const osrm = (process.env.OSRM_URL ?? "http://osrm:5000").replace(/\/$/, "");
  const run = async () => {
    try {
      let osrmOk: boolean | null = null;
      try {
        const r = await fetch(`${osrm}/nearest/v1/driving/-99.1332,19.4326`, { signal: AbortSignal.timeout(3000) });
        osrmOk = r.ok;
      } catch {
        osrmOk = false;
      }
      const sent = await syncAlerts(prisma, await evaluateAlerts(prisma, { osrmOk }), "worker");
      if (sent.length) console.log(`[worker] Alertas enviadas: ${sent.join(", ")}`);
    } catch (e) {
      console.error("[worker] Alertas:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, 5 * 60_000);
}

/** Limpieza diaria a las 04:00 CDMX (y al arrancar si ya pasó un día). */
function startCleanup() {
  let lastDay = "";
  const run = async () => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hour12: false }).format(new Date()));
    if (day === lastDay || hour < 4) return;
    lastDay = day;
    try {
      const db = await dailyCleanup(prisma);
      const photos = await shrinkOldPhotos();
      console.log(`[worker] Limpieza: ${JSON.stringify(db)} · fotos: ${JSON.stringify(photos)}`);
    } catch (e) {
      console.error("[worker] Limpieza:", e instanceof Error ? e.message : e);
    }
  };
  setInterval(run, 30 * 60_000);
}

async function main() {
  startHourlyJobs();
  startMlSync();
  startNotifier();
  startBackups();
  startWebhooks();
  startAlerts();
  startCleanup();
  console.log(`[worker] Revisando Gmail cada ${EVERY_MS / 1000} s`);
  for (;;) {
    const cfg = config();
    if (!cfg) {
      console.log("[worker] Faltan GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o GMAIL_REFRESH_TOKEN; reintento en 10 min.");
      await reportHealth(prisma, "gmail", false, "Sin autorizar (faltan GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o GMAIL_REFRESH_TOKEN)").catch(() => {});
      await new Promise((r) => setTimeout(r, 600_000));
      continue;
    }
    try {
      const r = await pollOnce(cfg);
      if (r.applied || r.unidentified) console.log(`[worker] ${r.applied} abono(s) aplicados, ${r.unidentified} por revisar`);
      await reportHealth(prisma, "gmail", true, `${r.seen} aviso(s) recientes; ${r.applied} aplicados y ${r.unidentified} por revisar en esta vuelta`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[worker] Error al revisar Gmail:", msg);
      await reportHealth(prisma, "gmail", false, msg).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}

if (process.argv[1]?.endsWith("index.ts")) void main();
