// Proceso en segundo plano: revisa Gmail y aplica los depósitos de Fondeadora [F04, I03].
import "dotenv/config";
import { ingestFondeadoraEmail, prisma, refreshAllBlockedPickups } from "@packatelas/db";
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
    const r = await ingestFondeadoraEmail(prisma, { externalId: msg.id, receivedAt: msg.receivedAt, text: msg.text });
    if (r.status === "applied") applied++;
    if (r.status === "unidentified") unidentified++;
  }
  return { seen: ids.length, applied, unidentified };
}

/** Cada hora: bloqueo/desbloqueo de recolecciones (el lunes, los de crédito sin liquidar) [F08]. */
function startHourlyJobs() {
  const run = () =>
    refreshAllBlockedPickups(prisma)
      .then((n) => n && console.log(`[worker] Bloqueos de recolección revisados (${n} cliente(s))`))
      .catch((e) => console.error("[worker] Error al revisar bloqueos:", e instanceof Error ? e.message : e));
  void run();
  setInterval(run, 3600_000);
}

async function main() {
  startHourlyJobs();
  console.log(`[worker] Revisando Gmail cada ${EVERY_MS / 1000} s`);
  for (;;) {
    const cfg = config();
    if (!cfg) {
      console.log("[worker] Faltan GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o GMAIL_REFRESH_TOKEN; reintento en 10 min.");
      await new Promise((r) => setTimeout(r, 600_000));
      continue;
    }
    try {
      const r = await pollOnce(cfg);
      if (r.applied || r.unidentified) console.log(`[worker] ${r.applied} abono(s) aplicados, ${r.unidentified} por revisar`);
    } catch (e) {
      console.error("[worker] Error al revisar Gmail:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}

if (process.argv[1]?.endsWith("index.ts")) void main();
