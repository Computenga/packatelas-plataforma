// Recepción directa del checador ZKTeco por el protocolo ADMS ("PUSH SDK") [A23].
// El reloj llama a /iclock/cdata y /iclock/getrequest; aquí se interpreta lo que manda.
// Viene APAGADO: hasta que el admin lo active y registre el número de serie, se ignora todo.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { importPunches, type PunchImportRow } from "./attendance.ts";

// La configuración (activada, relojes e IPs permitidas) solo la escribe el admin; los contactos
// de los relojes se guardan aparte para que una petición pública nunca pueda cambiarla.
const KEY = "checador.adms";
const DEVICES = "checador.adms.devices";
const MAX_DEVICES = 20;

export type AdmsDevice = { lastAt: string; ip?: string; punches: number; lastPunchAt?: string; info?: string; rejected?: number };
export type AdmsConfig = { enabled: boolean; serials: string[]; ips: string[]; devices: Record<string, AdmsDevice> };

export async function getAdmsConfig(prisma: PrismaClient): Promise<AdmsConfig> {
  const [row, dev] = await Promise.all([
    prisma.setting.findUnique({ where: { key: KEY } }),
    prisma.setting.findUnique({ where: { key: DEVICES } }),
  ]);
  const v = (row?.value as Partial<AdmsConfig> | undefined) ?? {};
  return { enabled: !!v.enabled, serials: v.serials ?? [], ips: v.ips ?? [], devices: (dev?.value as Record<string, AdmsDevice> | undefined) ?? {} };
}

async function saveDevices(prisma: PrismaClient, d: Record<string, AdmsDevice>) {
  await prisma.setting.upsert({ where: { key: DEVICES }, update: { value: d }, create: { key: DEVICES, value: d } });
}

const cleanSn = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
const cleanIp = (s: string) => s.trim().replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45);

/** Solo el admin: activar, relojes autorizados y la IP pública de la oficina desde donde mandan. */
export async function setAdmsConfig(prisma: PrismaClient, enabled: boolean, serials: string[], ips: string[] = []) {
  const value = {
    enabled,
    serials: [...new Set(serials.map(cleanSn).filter(Boolean))].slice(0, 10),
    ips: [...new Set(ips.map(cleanIp).filter(Boolean))].slice(0, 10),
  };
  await prisma.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return { ...value, devices: (await getAdmsConfig(prisma)).devices };
}

/** Quitar un reloj de la lista de contactos (no autorizado o de prueba). */
export async function forgetAdmsDevice(prisma: PrismaClient, snRaw: string) {
  const c = await getAdmsConfig(prisma);
  delete c.devices[cleanSn(snRaw)];
  await saveDevices(prisma, c.devices);
}

/**
 * ¿Este reloj puede mandar checadas? Hace falta que la recepción esté activa, que su número de
 * serie esté autorizado y que llame desde una IP permitida (el número de serie no es secreto).
 * Registra el contacto para verlo en pantalla, sin tocar la configuración.
 */
export async function admsContact(prisma: PrismaClient, snRaw: string | null, ip?: string, info?: string) {
  const sn = cleanSn(snRaw ?? "");
  if (!sn) return { sn, allowed: false };
  const c = await getAdmsConfig(prisma);
  const prev = c.devices[sn];
  const allowed = c.enabled && c.serials.includes(sn) && !!ip && c.ips.includes(ip);
  // Para no escribir en cada consulta (el reloj pregunta cada pocos segundos), máximo una vez por minuto.
  if ((!prev || Date.now() - new Date(prev.lastAt).getTime() > 60_000) && (prev || Object.keys(c.devices).length < MAX_DEVICES)) {
    c.devices[sn] = { ...prev, punches: prev?.punches ?? 0, lastAt: new Date().toISOString(), ip, ...(info ? { info: info.slice(0, 300) } : {}) };
    await saveDevices(prisma, c.devices);
  }
  return { sn, allowed };
}

const STATUS: Record<string, string> = { "0": "entrada", "1": "salida", "2": "salida_comida", "3": "regreso_comida", "4": "entrada", "5": "salida" };
const VERIFY: Record<string, string> = { "0": "contraseña", "1": "huella", "2": "tarjeta", "4": "tarjeta", "15": "rostro" };

/**
 * Renglones ATTLOG: "PIN\tAAAA-MM-DD HH:MM:SS\testado\tverificación\t…" en hora local del reloj (CDMX).
 * Devuelve solo los válidos; los demás se cuentan como descartados.
 */
export function parseAttlog(body: string, sn: string, tz = "-06:00", now = Date.now()) {
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
    // Ni del futuro ni de más de 45 días atrás.
    if (Number.isNaN(at.getTime()) || at.getTime() > now + 10 * 60_000 || at.getTime() < now - 45 * 86400_000) {
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
  d.rejected = (d.rejected ?? 0) + skipped;
  d.lastAt = new Date().toISOString();
  if (rows.length) d.lastPunchAt = rows.reduce((a, b) => (a.at > b.at ? a : b)).at.toISOString();
  c.devices[sn] = d;
  await saveDevices(prisma, c.devices);
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
