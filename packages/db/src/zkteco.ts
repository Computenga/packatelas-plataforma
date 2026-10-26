// Recepción directa del checador ZKTeco por el protocolo ADMS ("PUSH SDK") [A23].
// El reloj llama a /iclock/cdata y /iclock/getrequest; aquí se interpreta lo que manda.
// Viene APAGADO: hasta que el admin lo active y registre el número de serie, se ignora todo.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { importPunches, type PunchImportRow } from "./attendance.ts";

const KEY = "checador.adms";

export type AdmsDevice = { lastAt: string; ip?: string; punches: number; lastPunchAt?: string; info?: string };
export type AdmsConfig = { enabled: boolean; serials: string[]; devices: Record<string, AdmsDevice> };

export async function getAdmsConfig(prisma: PrismaClient): Promise<AdmsConfig> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return { enabled: false, serials: [], devices: {}, ...((row?.value as Partial<AdmsConfig> | undefined) ?? {}) };
}

async function save(prisma: PrismaClient, c: AdmsConfig) {
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: c }, create: { key: KEY, value: c } });
}

const cleanSn = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);

export async function setAdmsConfig(prisma: PrismaClient, enabled: boolean, serials: string[]) {
  const c = await getAdmsConfig(prisma);
  c.enabled = enabled;
  c.serials = [...new Set(serials.map(cleanSn).filter(Boolean))].slice(0, 10);
  await save(prisma, c);
  return c;
}

/** ¿Este reloj está autorizado? Registra el contacto (también de relojes no autorizados, para verlos en pantalla). */
export async function admsContact(prisma: PrismaClient, snRaw: string | null, ip?: string, info?: string) {
  const sn = cleanSn(snRaw ?? "");
  if (!sn) return { sn, allowed: false };
  const c = await getAdmsConfig(prisma);
  const prev = c.devices[sn];
  // Para no escribir en cada consulta (el reloj pregunta cada pocos segundos), solo si pasó 1 min.
  if (!prev || Date.now() - new Date(prev.lastAt).getTime() > 60_000 || info) {
    if (Object.keys(c.devices).length < 20 || prev) {
      c.devices[sn] = { ...prev, punches: prev?.punches ?? 0, lastAt: new Date().toISOString(), ip, ...(info ? { info: info.slice(0, 300) } : {}) };
      await save(prisma, c);
    }
  }
  return { sn, allowed: c.enabled && c.serials.includes(sn) };
}

const STATUS: Record<string, string> = { "0": "entrada", "1": "salida", "2": "salida_comida", "3": "regreso_comida", "4": "entrada", "5": "salida" };
const VERIFY: Record<string, string> = { "0": "contraseña", "1": "huella", "2": "tarjeta", "4": "tarjeta", "15": "rostro" };

/**
 * Renglones ATTLOG: "PIN\tAAAA-MM-DD HH:MM:SS\testado\tverificación\t…" en hora local del reloj (CDMX).
 * Devuelve solo los válidos; los demás se cuentan como descartados.
 */
export function parseAttlog(body: string, sn: string, tz = "-06:00") {
  const rows: PunchImportRow[] = [];
  let skipped = 0;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [pin, ts, status, verify] = line.split("\t").map((s) => s.trim());
    const no = Number(pin);
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(ts ?? "");
    if (!Number.isInteger(no) || no <= 0 || !m) {
      skipped++;
      continue;
    }
    const at = new Date(`${m[1]}T${m[2]}${tz}`);
    if (Number.isNaN(at.getTime())) {
      skipped++;
      continue;
    }
    rows.push({ employeeNo: no, at, kind: STATUS[status ?? ""], method: VERIFY[verify ?? ""], device: `ZKTeco ${sn}` });
  }
  return { rows, skipped };
}

/** Guarda checadas que mandó un reloj autorizado. */
export async function admsReceiveAttlog(prisma: PrismaClient, sn: string, body: string) {
  const { rows, skipped } = parseAttlog(body, sn);
  const r = rows.length ? await importPunches(prisma, rows, "zkteco") : { added: 0, duplicates: 0, unknownEmployees: [] as number[] };
  const c = await getAdmsConfig(prisma);
  const d = c.devices[sn] ?? { lastAt: new Date().toISOString(), punches: 0 };
  d.punches += r.added;
  d.lastAt = new Date().toISOString();
  if (rows.length) d.lastPunchAt = rows.reduce((a, b) => (a.at > b.at ? a : b)).at.toISOString();
  c.devices[sn] = d;
  await save(prisma, c);
  return { received: rows.length + skipped, ...r, skipped };
}

/** Respuesta al saludo inicial del reloj: qué mandar y cada cuánto. */
export function admsOptions(sn: string) {
  return [
    `GET OPTION FROM: ${sn}`,
    "ATTLOGStamp=None",
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=9999",
    "ErrorDelay=60",
    "Delay=30",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    "TimeZone=-6",
    "Realtime=1",
    "Encrypt=None",
  ].join("\n");
}
