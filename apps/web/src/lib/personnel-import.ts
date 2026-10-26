// Lectura de lo pegado desde el Sheet actual (pestañas "Personal"/"Empleados" y "Checadas") o de
// un CSV exportado del ZKTeco [A22, A23]. Las columnas de PIN y llaves NO se importan.
import type { EmployeeImportRow, PunchImportRow } from "@packatelas/db";
import { norm, parseTable } from "./bulk-import";

const W: Record<string, string> = {
  "no_empleado": "employeeNo", "no. empleado": "employeeNo", "no empleado": "employeeNo", "numero de empleado": "employeeNo", "no.": "employeeNo", "id": "employeeNo", "user id": "employeeNo", "ac-no.": "employeeNo",
  "nombre": "name", "name": "name", "rfc": "rfc", "curp": "curp", "nss": "nss", "puesto": "position", "area": "area", "rol": "kind",
  "estatus": "status", "fecha_ingreso": "hireDate", "fecha de ingreso": "hireDate", "fecha_baja": "endDate", "fecha de baja": "endDate",
  "salario_diario": "dailySalary", "salario diario": "dailySalary", "clabe": "clabe", "banco": "bank", "telefono": "phone", "celular": "phone",
  "correo": "email", "hora_entrada": "entryTime", "hora de entrada": "entryTime", "dias_laborales": "workdays", "dias laborales": "workdays",
  "minutos_comida": "lunchMinutes", "minutos de comida": "lunchMinutes", "checadas": "punchesPerDay", "moto_tipo": "motoType", "domicilio": "address",
};

const ymd = (raw: string): string | undefined => {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // dd/mm/aaaa (es-MX)
  return undefined;
};

export type ParsedEmployees = { rows: EmployeeImportRow[]; errors: string[]; ignored: string[] };

export function parseEmployees(
  text: string,
  helpers: { workdays: (s: string) => number[] | null; clock: (s: string) => string | null },
): ParsedEmployees {
  const t = parseTable(text);
  if (t.length < 2) return { rows: [], errors: ["Pega los encabezados y al menos un renglón"], ignored: [] };
  const map = new Map<string, number>();
  const ignored: string[] = [];
  t[0].forEach((h, i) => {
    const k = W[norm(h)];
    if (k && !map.has(k)) map.set(k, i);
    else if (h.trim()) ignored.push(h.trim());
  });
  if (!map.has("employeeNo") || !map.has("name")) return { rows: [], errors: ['Faltan las columnas "no_empleado" y "nombre"'], ignored };
  const rows: EmployeeImportRow[] = [];
  const errors: string[] = [];
  t.slice(1).forEach((cells, idx) => {
    const g = (k: string) => (map.has(k) ? (cells[map.get(k)!] ?? "").trim() : "");
    const no = Number(g("employeeNo").replace(/\D/g, ""));
    if (!no || !g("name")) { errors.push(`Renglón ${idx + 2}: falta número o nombre`); return; }
    const r: EmployeeImportRow = { employeeNo: no, name: g("name").slice(0, 160) };
    for (const k of ["rfc", "curp", "nss", "position", "area", "kind", "clabe", "bank", "phone", "email", "motoType", "address"] as const) {
      const v = g(k);
      if (v) r[k] = v.slice(0, 300);
    }
    const st = norm(g("status"));
    if (st) r.status = /baja|inactiv/.test(st) ? "BAJA" : "ACTIVO";
    const hd = ymd(g("hireDate")), ed = ymd(g("endDate"));
    if (hd) r.hireDate = hd;
    if (ed) r.endDate = ed;
    const sal = Number(g("dailySalary").replace(/[$,\s]/g, ""));
    if (g("dailySalary") && Number.isFinite(sal) && sal >= 0) r.dailySalary = sal;
    const et = helpers.clock(g("entryTime"));
    if (et) r.entryTime = et;
    const wd = helpers.workdays(g("workdays"));
    if (wd) r.workdays = wd;
    const lm = Number(g("lunchMinutes"));
    if (g("lunchMinutes") && Number.isInteger(lm) && lm >= 0 && lm <= 240) r.lunchMinutes = lm;
    const pp = Number(g("punchesPerDay"));
    if (pp === 2 || pp === 4) r.punchesPerDay = pp;
    rows.push(r);
  });
  return { rows, errors, ignored };
}

/** Checadas: pestaña "Checadas" (Fecha, Hora, No. empleado, Tipo…) o CSV con fecha y hora juntas. */
export function parsePunches(text: string, kind: (s: string) => string | undefined): { rows: PunchImportRow[]; errors: string[] } {
  const t = parseTable(text);
  if (t.length < 2) return { rows: [], errors: ["Pega los encabezados y al menos una checada"] };
  const h = t[0].map(norm);
  const find = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const iNo = find("no. empleado", "no empleado", "no_empleado", "no.", "id", "user id", "ac-no.", "numero de empleado");
  const iDate = find("fecha");
  const iTime = find("hora");
  const iBoth = find("fecha/hora", "fecha y hora", "fecha hora", "hora y fecha", "datetime", "time", "checktime");
  const iKind = find("tipo", "estado", "state", "checktype");
  const iDev = find("dispositivo", "device", "terminal");
  const iMet = find("metodo", "verificacion", "verify");
  const iUuid = find("uuid");
  if (iNo < 0 || (iBoth < 0 && (iDate < 0 || iTime < 0))) return { rows: [], errors: ['Faltan columnas: "No. empleado" y "Fecha" + "Hora" (o "Fecha/Hora")'] };
  const rows: PunchImportRow[] = [];
  const errors: string[] = [];
  t.slice(1).forEach((c, idx) => {
    const no = Number((c[iNo] ?? "").replace(/\D/g, ""));
    const both = iBoth >= 0 ? (c[iBoth] ?? "").trim() : `${c[iDate] ?? ""} ${c[iTime] ?? ""}`.trim();
    const d = ymd(both);
    const tm = both.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.\s?m\.|p\.\s?m\.)?\s*$/i);
    if (!no || !d || !tm) { if (errors.length < 20) errors.push(`Renglón ${idx + 2}: no se entiende "${both}"`); return; }
    let hh = Number(tm[1]);
    if (tm[4]?.toLowerCase().startsWith("p") && hh < 12) hh += 12;
    if (tm[4]?.toLowerCase().startsWith("a") && hh === 12) hh = 0;
    const at = new Date(`${d}T${String(hh).padStart(2, "0")}:${tm[2]}:${(tm[3] ?? "00").padStart(2, "0")}-06:00`);
    if (Number.isNaN(at.getTime())) return;
    rows.push({
      employeeNo: no, at,
      kind: iKind >= 0 ? kind(c[iKind] ?? "") : undefined,
      device: iDev >= 0 ? (c[iDev] ?? "").slice(0, 80) || undefined : undefined,
      method: iMet >= 0 ? (c[iMet] ?? "").slice(0, 40) || undefined : undefined,
      externalId: iUuid >= 0 ? (c[iUuid] ?? "").slice(0, 80) || undefined : undefined,
    });
  });
  return { rows, errors };
}
