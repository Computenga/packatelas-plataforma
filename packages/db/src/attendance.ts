// Personal y asistencia [A22, A23]. Reglas (las mismas del Sheet actual del checador):
// - Cada empleado tiene su hora de entrada y sus días laborales; tolerancia 0 minutos.
// - Los minutos tarde se suman por quincena (1–15 y 16–fin de mes).
// - Día laboral sin checadas = falta (1 día = 8 h), salvo día justificado.
// - Si checa comida (4 checadas), los minutos de comida de más también se descuentan.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

export { normalizePunchKind, parseClock, parseWorkdays } from "./attendance-rules.ts";

type Db = PrismaClient | Prisma.TransactionClient;

const TZ = "-06:00";
const YMD_MX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const HM_MX = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false });
export const ymdMx = (d: Date) => YMD_MX.format(d);
const hmMx = (d: Date) => HM_MX.format(d);
const weekday = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Quincena que contiene la fecha: 1–15 o 16–fin de mes. */
export function quincenaOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  const first = d <= 15;
  const from = `${y}-${mm}-${first ? "01" : "16"}`;
  const to = `${y}-${mm}-${first ? "15" : String(last)}`;
  const month = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return { from, to, key: `${y}-${mm}-${first ? "1" : "2"}`, label: `${first ? "1ª" : "2ª"} quincena (${first ? "1" : "16"}–${first ? 15 : last} ${month} ${y})` };
}

export function shiftQuincena(key: string, delta: number) {
  const [y, m, q] = key.split("-").map(Number);
  let idx = (y * 12 + (m - 1)) * 2 + (q - 1) + delta;
  const nq = (idx % 2) + 1;
  idx = Math.floor(idx / 2);
  return quincenaOf(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-${nq === 1 ? "01" : "16"}`);
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = new Date(`${from}T12:00:00Z`); t.toISOString().slice(0, 10) <= to; t = new Date(t.getTime() + 86400_000)) {
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

export type DayStatus = "a_tiempo" | "retardo" | "falta" | "justificada" | "descanso" | "pendiente" | "fuera";
export type AttendanceDay = {
  date: string; weekday: number; status: DayStatus; expected: string | null; entry: string | null;
  lateMinutes: number; lunchOut: string | null; lunchIn: string | null; lunchMinutes: number | null; extraLunch: number; punches: string[]; note?: string;
};
export type AttendanceSummary = {
  days: AttendanceDay[]; workdays: number; worked: number; absences: number; justified: number;
  lateMinutes: number; extraLunchMinutes: number; lateDays: number; discount: number | null;
};

type EmpRule = { entryTime: string | null; workdays: number[]; lunchMinutes: number; punchesPerDay: number; hireDate: Date | null; endDate: Date | null; dailySalary: number | null };

/** Calcula la asistencia de un empleado en un rango (fechas AAAA-MM-DD, hora CDMX). */
export function computeAttendance(
  emp: EmpRule,
  punches: { at: Date; kind?: string | null }[],
  justified: Map<string, string>, // fecha → motivo (del empleado o de todos)
  from: string,
  to: string,
  now = new Date(),
): AttendanceSummary {
  const today = ymdMx(now);
  const byDay = new Map<string, { at: Date; kind?: string | null }[]>();
  for (const p of [...punches].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const d = ymdMx(p.at);
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }
  const hire = emp.hireDate ? emp.hireDate.toISOString().slice(0, 10) : null;
  const end = emp.endDate ? emp.endDate.toISOString().slice(0, 10) : null;
  const days: AttendanceDay[] = [];
  for (const date of eachDay(from, to)) {
    if (date > today) break;
    const wd = weekday(date);
    const ps = byDay.get(date) ?? [];
    const base: AttendanceDay = {
      date, weekday: wd, status: "a_tiempo", expected: emp.entryTime, entry: null, lateMinutes: 0, lunchOut: null, lunchIn: null,
      lunchMinutes: null, extraLunch: 0, punches: ps.map((p) => hmMx(p.at)),
    };
    if ((hire && date < hire) || (end && date > end)) { days.push({ ...base, status: "fuera" }); continue; }
    if (!emp.workdays.includes(wd)) { days.push({ ...base, status: "descanso" }); continue; }
    const why = justified.get(date);
    if (why) { days.push({ ...base, status: "justificada", note: why }); continue; }
    if (!ps.length) { days.push({ ...base, status: date === today ? "pendiente" : "falta" }); continue; }

    const entry = ps.find((p) => p.kind === "entrada") ?? ps[0];
    base.entry = hmMx(entry.at);
    if (emp.entryTime) {
      const expected = new Date(`${date}T${emp.entryTime}:00${TZ}`);
      base.lateMinutes = Math.max(0, Math.floor((entry.at.getTime() - expected.getTime()) / 60_000));
    }
    if (emp.punchesPerDay >= 4) {
      const out = ps.find((p) => p.kind === "salida_comida") ?? (ps.length >= 3 ? ps[1] : undefined);
      const back = ps.find((p) => p.kind === "regreso_comida") ?? (ps.length >= 3 ? ps[2] : undefined);
      if (out && back && back.at > out.at) {
        base.lunchOut = hmMx(out.at);
        base.lunchIn = hmMx(back.at);
        base.lunchMinutes = Math.round((back.at.getTime() - out.at.getTime()) / 60_000);
        base.extraLunch = Math.max(0, base.lunchMinutes - emp.lunchMinutes);
      }
    }
    base.status = base.lateMinutes > 0 ? "retardo" : "a_tiempo";
    days.push(base);
  }
  const work = days.filter((d) => !["descanso", "fuera"].includes(d.status));
  const absences = work.filter((d) => d.status === "falta").length;
  const lateMinutes = work.reduce((a, d) => a + d.lateMinutes, 0);
  const extraLunchMinutes = work.reduce((a, d) => a + d.extraLunch, 0);
  const discount = emp.dailySalary == null ? null : Math.round((absences * emp.dailySalary + ((lateMinutes + extraLunchMinutes) / 60) * (emp.dailySalary / 8)) * 100) / 100;
  return {
    days, workdays: work.length, worked: work.filter((d) => d.status === "a_tiempo" || d.status === "retardo").length, absences,
    justified: work.filter((d) => d.status === "justificada").length, lateMinutes, extraLunchMinutes,
    lateDays: work.filter((d) => d.status === "retardo").length, discount,
  };
}

/** Asistencia de varios empleados en un rango, con sus checadas y justificaciones de la base. */
export async function attendanceReport(db: Db, from: string, to: string, employeeIds?: string[], now = new Date()) {
  const start = new Date(`${from}T00:00:00${TZ}`);
  const stop = new Date(new Date(`${to}T00:00:00${TZ}`).getTime() + 86400_000);
  const emps = await db.employee.findMany({
    where: { ...(employeeIds ? { id: { in: employeeIds } } : {}), OR: [{ status: "ACTIVO" }, { endDate: { gte: start } }] },
    orderBy: { employeeNo: "asc" },
  });
  const [punches, justs] = await Promise.all([
    db.punch.findMany({ where: { employeeId: { in: emps.map((e) => e.id) }, at: { gte: start, lt: stop } }, select: { employeeId: true, at: true, kind: true } }),
    db.justification.findMany({ where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } }),
  ]);
  return emps.map((e) => {
    const j = new Map<string, string>();
    for (const x of justs) if (!x.employeeId || x.employeeId === e.id) j.set(x.date.toISOString().slice(0, 10), x.reason);
    const summary = computeAttendance(
      { entryTime: e.entryTime, workdays: e.workdays, lunchMinutes: e.lunchMinutes, punchesPerDay: e.punchesPerDay, hireDate: e.hireDate, endDate: e.endDate, dailySalary: e.dailySalary == null ? null : Number(e.dailySalary) },
      punches.filter((p) => p.employeeId === e.id), j, from, to, now,
    );
    return { employee: e, ...summary };
  });
}

// ── Importación (solo lectura de los sistemas actuales) ─────────────────────

export type EmployeeImportRow = {
  employeeNo: number; name: string; rfc?: string; curp?: string; nss?: string; position?: string; area?: string; kind?: string;
  status?: "ACTIVO" | "BAJA"; hireDate?: string; endDate?: string; dailySalary?: number; clabe?: string; bank?: string; phone?: string;
  email?: string; entryTime?: string; workdays?: number[]; lunchMinutes?: number; punchesPerDay?: number; motoType?: string; address?: string;
};

export async function importEmployees(prisma: PrismaClient, rows: EmployeeImportRow[], actorUserId?: string) {
  let created = 0, updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const data = Object.fromEntries(
        Object.entries({
          ...r,
          hireDate: r.hireDate ? new Date(`${r.hireDate}T00:00:00Z`) : undefined,
          endDate: r.endDate ? new Date(`${r.endDate}T00:00:00Z`) : undefined,
          dailySalary: r.dailySalary != null ? new Prisma.Decimal(r.dailySalary) : undefined,
          rfc: r.rfc?.toUpperCase(), curp: r.curp?.toUpperCase(),
        }).filter(([, v]) => v !== undefined && v !== ""),
      ) as unknown as Prisma.EmployeeUncheckedCreateInput;
      const exists = await tx.employee.findUnique({ where: { employeeNo: r.employeeNo }, select: { id: true } });
      if (exists) { await tx.employee.update({ where: { id: exists.id }, data }); updated++; }
      else { await tx.employee.create({ data }); created++; }
    }
    await audit(tx, { actorUserId, action: "employees.imported", entity: "Employee", summary: `Personal importado: ${created} nuevos, ${updated} actualizados` });
  }, { timeout: 60_000 });
  return { created, updated };
}

export type PunchImportRow = { employeeNo: number; at: Date; kind?: string; device?: string; method?: string; externalId?: string };

/** Agrega checadas; las repetidas (mismo empleado y hora, o mismo UUID) se ignoran. */
export async function importPunches(prisma: PrismaClient, rows: PunchImportRow[], source = "import") {
  const emps = new Map((await prisma.employee.findMany({ select: { id: true, employeeNo: true } })).map((e) => [e.employeeNo, e.id]));
  const unknown = new Set<number>();
  const data = rows.flatMap((r) => {
    const employeeId = emps.get(r.employeeNo);
    if (!employeeId) { unknown.add(r.employeeNo); return []; }
    return [{ employeeId, at: r.at, kind: r.kind, device: r.device, method: r.method, externalId: r.externalId || null, source }];
  });
  const r = await prisma.punch.createMany({ data, skipDuplicates: true });
  return { added: r.count, duplicates: data.length - r.count, unknownEmployees: [...unknown].sort((a, b) => a - b) };
}

export async function addJustification(prisma: PrismaClient, j: { date: string; employeeId?: string | null; reason: string; note?: string }, actorUserId?: string) {
  const row = await prisma.justification.create({
    data: { date: new Date(`${j.date}T00:00:00Z`), employeeId: j.employeeId || null, reason: j.reason.slice(0, 120), note: j.note?.slice(0, 300) || null, createdById: actorUserId },
  });
  await audit(prisma, { actorUserId, action: "attendance.justified", entity: "Justification", entityId: row.id, summary: `Día ${j.date} justificado (${j.reason})${j.employeeId ? "" : " para todos"}` });
  return row;
}
