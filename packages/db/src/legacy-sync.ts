// Unificación de RH, checador y flotilla [A37], SIN apagar lo actual.
// Las hojas de Google que hoy usan el checador (ZKTeco → Sheets, portal de empleados) y la app de
// flotilla siguen siendo la fuente mientras dura la transición: la plataforma solo LEE de ellas
// cada pocos minutos y copia lo nuevo. Nunca escribe en las hojas, así que si algo sale mal aquí
// el sistema actual sigue intacto y sirve de consulta y respaldo.
// Llaves para no duplicar: no. de empleado, UUID de la checada, M-01, CH-/CG-/F-/R-.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { driveRefreshToken } from "./drive.ts";
import { importEmployees, importPunches } from "./attendance.ts";
import { normalizePunchKind, parseClock, parseWorkdays } from "./attendance-rules.ts";
import { parseEmployees, parsePunches } from "./personnel-import.ts";

const KEY = "legacy.sync";
const STATUS = "legacy.sync.status";
export const LEGACY_DEFAULTS = {
  checadorSheetId: "1U6RRubCwjpfmOilWSWRY1txh7dwP9d7SdAxXWmpxsf0",
  flotillaSheetId: "1T8HpYcqdHRU-ohgFGZGuNMiI3mrPWFdAZr7o37XXPmo",
};

export type LegacyConfig = { enabled: boolean; checadorSheetId: string; flotillaSheetId: string };
export type LegacyStatus = { at: string; ok: boolean; results: Record<string, string>; errors: string[] };
export type SheetReader = (spreadsheetId: string, range: string) => Promise<string[][]>;

export async function getLegacyConfig(db: PrismaClient): Promise<LegacyConfig> {
  const v = ((await db.setting.findUnique({ where: { key: KEY } }))?.value ?? {}) as Partial<LegacyConfig>;
  return { enabled: !!v.enabled, checadorSheetId: v.checadorSheetId || LEGACY_DEFAULTS.checadorSheetId, flotillaSheetId: v.flotillaSheetId || LEGACY_DEFAULTS.flotillaSheetId };
}
export async function saveLegacyConfig(db: PrismaClient, c: LegacyConfig) {
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: c }, update: { value: c } });
}
export async function getLegacyStatus(db: PrismaClient) {
  return ((await db.setting.findUnique({ where: { key: STATUS } }))?.value ?? null) as LegacyStatus | null;
}

// ── Lectura de Google Sheets con el permiso de Google Drive conectado en Salud ──
export async function googleSheetsReader(prisma: PrismaClient, fetchImpl: typeof fetch = fetch): Promise<SheetReader | null> {
  const refresh = await driveRefreshToken(prisma);
  const id = process.env.GMAIL_CLIENT_ID?.trim(), secret = process.env.GMAIL_CLIENT_SECRET?.trim();
  if (!refresh || !id || !secret) return null;
  const t = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!t.ok) throw new Error(`Google no renovó el permiso (${t.status}). Vuelve a conectar Google Drive en Salud.`);
  const token = ((await t.json()) as { access_token: string }).access_token;
  return async (sheetId, range) => {
    const r = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (r.status === 403) throw new Error("Falta permiso para leer las hojas: en Salud, vuelve a «Conectar Google Drive» (ahora pide también lectura de hojas).");
    if (!r.ok) throw new Error(`Google Sheets respondió ${r.status} al leer ${range}`);
    return (((await r.json()) as { values?: string[][] }).values ?? []).map((row) => row.map((c) => String(c ?? "")));
  };
}

// ── Utilidades puras ──
const nrm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Filas de la hoja como objetos {encabezado normalizado: valor}. */
export function asRecords(t: string[][]): Record<string, string>[] {
  if (t.length < 2) return [];
  const h = t[0].map(nrm);
  return t.slice(1).filter((r) => r.some((c) => (c ?? "").trim())).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? "").trim()])));
}
/** "13/10/2026 9:58:34" o "2026-10-13 09:58" (hora de CDMX) → Date. */
export function legacyDate(s: string | undefined): Date | null {
  const v = (s ?? "").trim();
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let y: string, mo: string, d: string, hh = "0", mi = "0", ss = "0";
  if (m) [, d, mo, y, hh = "0", mi = "0", ss = "0"] = m as unknown as string[];
  else {
    m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    [, y, mo, d, hh = "0", mi = "0", ss = "0"] = m as unknown as string[];
  }
  const p = (x: string) => x.padStart(2, "0");
  const dt = new Date(`${y}-${p(mo)}-${p(d)}T${p(hh ?? "0")}:${p(mi ?? "0")}:${p(ss ?? "0")}-06:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
const num = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/[$,\s]/g, ""));
  return (s ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};
/** U-77 / U-077 → 77 */
export const empNo = (s: string | undefined) => {
  const m = (s ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
};
const photos = (r: Record<string, string>, keys: string[]) => keys.map((k) => r[k]).filter((v) => /^https?:\/\//.test(v ?? ""));

// ── Checador y RH ──
async function syncChecador(prisma: PrismaClient, read: SheetReader, sheetId: string, out: Record<string, string>) {
  // Personal (datos completos) + Empleados (horario y checadas por día del ZKTeco).
  const [personal, empleados] = await Promise.all([read(sheetId, "Personal!A:AD"), read(sheetId, "Empleados!A:M")]);
  const helpers = { workdays: parseWorkdays, clock: parseClock };
  const p = parseEmployees(personal, helpers);
  const e = parseEmployees(empleados, helpers);
  const byNo = new Map(p.rows.map((r) => [r.employeeNo, r]));
  const perDay = new Map(asRecords(empleados).map((r) => [Number(r["no. empleado"]), (r["checadas"] ?? "").split(",").filter(Boolean).length]));
  for (const r of e.rows) {
    const cur = byNo.get(r.employeeNo);
    // Empleados manda en horario (es lo que usa el reloj); Personal en lo demás.
    byNo.set(r.employeeNo, { ...(cur ?? { employeeNo: r.employeeNo, name: r.name }), ...(r.entryTime ? { entryTime: r.entryTime } : {}), ...(r.workdays ? { workdays: r.workdays } : {}), ...(r.lunchMinutes != null ? { lunchMinutes: r.lunchMinutes } : {}), ...(r.hireDate && !cur?.hireDate ? { hireDate: r.hireDate } : {}) });
  }
  for (const [no, n] of perDay) {
    const cur = byNo.get(no);
    if (cur && (n === 2 || n === 4)) cur.punchesPerDay = n;
  }
  // Solo lo que cambió, para no reescribir 100 empleados cada vuelta.
  const existing = new Map((await prisma.employee.findMany({ select: { employeeNo: true, updatedAt: true, name: true, entryTime: true, status: true, phone: true } })).map((x) => [x.employeeNo, x]));
  const rows = [...byNo.values()].filter((r) => {
    const x = existing.get(r.employeeNo);
    return !x || x.name !== r.name || (r.entryTime && x.entryTime !== r.entryTime) || (r.status && x.status !== r.status) || (r.phone && x.phone !== r.phone);
  });
  if (rows.length) {
    const r = await importEmployees(prisma, rows);
    out.empleados = `${r.created} nuevos, ${r.updated} actualizados`;
  } else out.empleados = "sin cambios";

  const punches = parsePunches(await read(sheetId, "Checadas!A:L"), normalizePunchKind);
  const r = await importPunches(prisma, punches.rows, "hoja");
  out.checadas = `${r.added} nuevas${r.updated ? `, ${r.updated} corregidas` : ""}` + (r.unknownEmployees.length ? ` · sin empleado: ${r.unknownEmployees.slice(0, 8).join(", ")}` : "");

  // Justificadas: fecha + empleado (vacío = todos) + motivo; se agregan las que no existan.
  const just = asRecords(await read(sheetId, "Justificadas!A:D"));
  const emps = new Map((await prisma.employee.findMany({ select: { id: true, employeeNo: true } })).map((x) => [x.employeeNo, x.id]));
  let added = 0;
  for (const j of just) {
    const d = legacyDate(j["fecha"]);
    const no = empNo(j["no. empleado (vacio = todos)"]);
    const reason = (j["motivo"] || "Justificada").slice(0, 120);
    if (!d) continue;
    const employeeId = no ? emps.get(no) ?? null : null;
    if (no && !employeeId) continue;
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);
    const day = new Date(`${ymd}T00:00:00Z`);
    const dup = await prisma.justification.findFirst({ where: { date: day, employeeId, reason } , select: { id: true } });
    if (dup) continue;
    await prisma.justification.create({ data: { date: day, employeeId, reason, note: (j["nota"] || "").slice(0, 300) || null } });
    added++;
  }
  out.justificadas = `${added} nuevas`;
}

// ── Flotilla ──
async function syncFlotilla(prisma: PrismaClient, read: SheetReader, sheetId: string, out: Record<string, string>) {
  const [veh, checks, fuel, faults, repairs, docs] = await Promise.all(
    ["Vehiculos!A:K", "Checks!A:O", "Combustible!A:L", "Fallas!A:O", "Reparaciones!A:U", "Documentos!A:J"].map((r) => read(sheetId, r).then(asRecords)),
  );
  const emps = new Map((await prisma.employee.findMany({ select: { id: true, employeeNo: true } })).map((x) => [x.employeeNo, x.id]));
  const empId = (u: string | undefined) => { const n = empNo(u); return n ? emps.get(n) ?? null : null; };
  const skipped: string[] = [];

  // Vehículos: alta y datos; el km solo sube.
  let vNew = 0;
  for (const v of veh) {
    const code = (v["vehiculo_id"] ?? "").toUpperCase();
    if (!/^M-\d+$/.test(code)) continue;
    const st = nrm(v["estatus"] ?? "");
    const data = {
      plate: v["placa"] || null, brand: v["marca"] || null, model: v["modelo"] || null, year: num(v["anio"]) ?? null, color: v["color"] || null, vin: v["num_serie"] || null,
      status: (/baja/.test(st) ? "BAJA" : /taller/.test(st) ? "TALLER" : "ACTIVO") as "BAJA" | "TALLER" | "ACTIVO",
    };
    const km = num(v["km_actual"]) ?? 0;
    const cur = await prisma.vehicle.findUnique({ where: { code }, select: { id: true, km: true } });
    if (cur) await prisma.vehicle.update({ where: { id: cur.id }, data: { ...data, ...(km > cur.km ? { km } : {}) } });
    else { await prisma.vehicle.create({ data: { code, ...data, km, notes: v["notas"] || null } }); vNew++; }
  }
  const vehicles = new Map((await prisma.vehicle.findMany({ select: { id: true, code: true } })).map((x) => [x.code, x.id]));
  const vid = (c: string | undefined) => vehicles.get((c ?? "").toUpperCase()) ?? null;

  // Checks
  let cNew = 0;
  const known = new Set((await prisma.vehicleCheck.findMany({ where: { legacyId: { not: null } }, select: { legacyId: true } })).map((x) => x.legacyId));
  for (const c of checks) {
    const id = c["check_id"];
    if (!id || known.has(id)) continue;
    const vehicleId = vid(c["vehiculo_id"]), employeeId = empId(c["usuario_id"]), at = legacyDate(c["fecha_hora"]);
    if (!vehicleId || !employeeId || !at) { skipped.push(id); continue; }
    await prisma.vehicleCheck.create({
      data: {
        legacyId: id, kind: /ruta/.test(nrm(c["tipo"] ?? "")) ? "ANTES_RUTA" : "MATUTINO", vehicleId, employeeId, at,
        km: num(c["km"]), kmDriven: num(c["km_recorridos"]), photos: photos(c, ["foto_1", "foto_2", "foto_3", "foto_4"]),
        odometerKey: /^https?:/.test(c["foto_odometro"] ?? "") ? c["foto_odometro"] : null, description: c["descripcion"] || null,
        lat: num(c["lat"]), lng: num(c["lng"]),
      },
    });
    cNew++;
  }
  const checkIds = new Map((await prisma.vehicleCheck.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((x) => [x.legacyId!, x.id]));

  // Combustible
  let gNew = 0;
  const knownFuel = new Set((await prisma.fuelLoad.findMany({ where: { legacyId: { not: null } }, select: { legacyId: true } })).map((x) => x.legacyId));
  for (const g of fuel) {
    const id = g["carga_id"];
    if (!id || knownFuel.has(id)) continue;
    const vehicleId = vid(g["vehiculo_id"]), employeeId = empId(g["usuario_id"]), at = legacyDate(g["fecha_hora"]), amount = num(g["monto"]);
    if (!vehicleId || !employeeId || !at || amount == null) { skipped.push(id); continue; }
    const liters = num(g["litros"]);
    await prisma.fuelLoad.create({
      data: { legacyId: id, vehicleId, employeeId, at, amount: new Prisma.Decimal(amount), liters: liters != null && liters < 200 ? new Prisma.Decimal(liters) : null, checkId: checkIds.get(g["check_id"]) ?? null, ticketKey: /^https?:/.test(g["foto_ticket"] ?? "") ? g["foto_ticket"] : null },
    });
    gNew++;
  }

  // Fallas (el estatus se actualiza en cada vuelta; el mecánico aún trabaja en la app actual)
  const FS: Record<string, "ABIERTA" | "EN_REPARACION" | "CERRADA" | "DESCARTADA"> = { abierta: "ABIERTA", en_reparacion: "EN_REPARACION", "en reparacion": "EN_REPARACION", cerrada: "CERRADA", reparada: "CERRADA", descartada: "DESCARTADA" };
  let fNew = 0, fUpd = 0;
  for (const f of faults) {
    const id = f["falla_id"];
    if (!id) continue;
    const status = FS[nrm(f["estatus"] ?? "")] ?? "ABIERTA";
    const cur = await prisma.fault.findUnique({ where: { legacyId: id }, select: { id: true, status: true } });
    if (cur) { if (cur.status !== status) { await prisma.fault.update({ where: { id: cur.id }, data: { status } }); fUpd++; } continue; }
    const vehicleId = vid(f["vehiculo_id"]), reportedById = empId(f["reportada_por"]), at = legacyDate(f["fecha_reporte"]);
    if (!vehicleId || !reportedById || !at) { skipped.push(id); continue; }
    await prisma.fault.create({
      data: {
        legacyId: id, kind: /no_?reportad/.test(nrm(f["tipo"] ?? "")) ? "no_reportada" : "reportada", checkId: checkIds.get(f["check_id"]) ?? null, vehicleId, reportedById,
        responsibleId: empId(f["responsable_id"]), description: (f["descripcion"] || "Sin descripción").slice(0, 1000), severity: ["baja", "media", "alta"].includes(nrm(f["severidad"] ?? "")) ? nrm(f["severidad"]) : "media",
        photos: photos(f, ["foto_1", "foto_2", "foto_3", "foto_4"]), status, mechanicNote: f["validacion_mecanico"] || null, createdAt: at,
      },
    });
    fNew++;
  }
  const faultIds = new Map((await prisma.fault.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((x) => [x.legacyId!, x.id]));

  // Reparaciones (se completan al cerrarse en la app actual)
  let rNew = 0, rUpd = 0;
  for (const r of repairs) {
    const id = r["rep_id"];
    if (!id) continue;
    const vehicleId = vid(r["vehiculo_id"]), startedAt = legacyDate(r["fecha_inicio"]);
    if (!vehicleId || !startedAt) { skipped.push(id); continue; }
    const cause = nrm(r["causa"] ?? "");
    const data = {
      closedAt: legacyDate(r["fecha_cierre"]), description: r["descripcion"] || null, photos: photos(r, ["foto_1", "foto_2", "foto_3", "foto_4"]),
      partsCost: new Prisma.Decimal(num(r["costo_refacciones"]) ?? 0), laborCost: new Prisma.Decimal(num(r["costo_mano_obra"]) ?? 0),
      cause: ["desgaste", "mal_uso", "ambos"].includes(cause.replace(" ", "_")) ? cause.replace(" ", "_") : null, responsibleId: empId(r["responsable_id"]),
      employeeAmount: new Prisma.Decimal(num(r["monto_empleado"]) ?? 0), companyAmount: new Prisma.Decimal(num(r["monto_empresa"]) ?? 0),
    };
    const cur = await prisma.repair.findUnique({ where: { legacyId: id }, select: { id: true, closedAt: true } });
    if (cur) { if (!cur.closedAt && data.closedAt) { await prisma.repair.update({ where: { id: cur.id }, data }); rUpd++; } continue; }
    const faultId = faultIds.get(r["falla_id"]) ?? null;
    // Una reparación por falla: si la plataforma ya tiene una para esa falla, no se duplica.
    if (faultId && (await prisma.repair.findUnique({ where: { faultId }, select: { id: true } }))) continue;
    await prisma.repair.create({ data: { legacyId: id, faultId, vehicleId, startedAt, ...data } });
    rNew++;
  }

  // Documentos y vigencias
  let dUpd = 0;
  for (const d of docs) {
    const vehicleId = vid(d["vehiculo_id"]);
    const type = nrm(d["tipo"] ?? "").replace(/\s+/g, "_");
    if (!vehicleId || !type) continue;
    const data = { folio: d["folio"] || null, issuedAt: legacyDate(d["fecha_emision"]), expiresAt: legacyDate(d["vigencia"]), evidenceKey: /^https?:/.test(d["evidencia"] ?? "") ? d["evidencia"] : null };
    await prisma.vehicleDocument.upsert({ where: { vehicleId_type: { vehicleId, type } }, create: { vehicleId, type, ...data }, update: data });
    dUpd++;
  }

  out.vehiculos = `${veh.length} (${vNew} nuevos)`;
  out.checks = `${cNew} nuevos`;
  out.gasolina = `${gNew} nuevas`;
  out.fallas = `${fNew} nuevas, ${fUpd} con estatus actualizado`;
  out.reparaciones = `${rNew} nuevas, ${rUpd} cerradas`;
  out.documentos = `${dUpd}`;
  if (skipped.length) out.omitidos = `${skipped.length} (sin moto o empleado conocido): ${skipped.slice(0, 6).join(", ")}${skipped.length > 6 ? "…" : ""}`;
}

/** Una vuelta completa. Cada parte falla por separado: un error en flotilla no frena el checador. */
export async function syncLegacy(prisma: PrismaClient, read?: SheetReader | null, opts: { force?: boolean } = {}): Promise<LegacyStatus> {
  const cfg = await getLegacyConfig(prisma);
  const results: Record<string, string> = {};
  const errors: string[] = [];
  if (!cfg.enabled && !opts.force) return { at: new Date().toISOString(), ok: true, results: { estado: "apagada" }, errors };
  const reader = read ?? (await googleSheetsReader(prisma).catch((e) => { errors.push(e instanceof Error ? e.message : String(e)); return null; }));
  if (!reader) {
    if (!errors.length) errors.push("Conecta Google Drive en Salud para poder leer las hojas.");
  } else {
    await syncChecador(prisma, reader, cfg.checadorSheetId, results).catch((e) => errors.push(`Checador: ${e instanceof Error ? e.message : e}`));
    await syncFlotilla(prisma, reader, cfg.flotillaSheetId, results).catch((e) => errors.push(`Flotilla: ${e instanceof Error ? e.message : e}`));
  }
  const status: LegacyStatus = { at: new Date().toISOString(), ok: errors.length === 0, results, errors };
  await prisma.setting.upsert({ where: { key: STATUS }, create: { key: STATUS, value: status }, update: { value: status } });
  return status;
}
