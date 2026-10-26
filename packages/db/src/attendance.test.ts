import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  prisma, parseWorkdays, parseClock, quincenaOf, shiftQuincena, computeAttendance, normalizePunchKind,
  importEmployees, importPunches, attendanceReport, addJustification,
} from "./index.ts";

const at = (s: string) => new Date(`${s}-06:00`);

describe("formatos", () => {
  it("días laborales en varios formatos", () => {
    expect(parseWorkdays("1,2,3,4,5,6")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseWorkdays("L-S")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseWorkdays("Lun a Sáb")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseWorkdays("L,M,X,J,V")).toEqual([1, 2, 3, 4, 5]);
    expect(parseWorkdays("LMXJVSD")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(parseWorkdays("")).toBeNull();
  });
  it("horas", () => {
    expect(parseClock("9")).toBe("09:00");
    expect(parseClock("10:30:00")).toBe("10:30");
    expect(parseClock("1:15 pm")).toBe("13:15");
    expect(parseClock("25:00")).toBeNull();
  });
  it("quincenas", () => {
    expect(quincenaOf("2026-10-20")).toMatchObject({ from: "2026-10-16", to: "2026-10-31", key: "2026-10-2" });
    expect(quincenaOf("2026-02-03")).toMatchObject({ from: "2026-02-01", to: "2026-02-15" });
    expect(quincenaOf("2026-02-20").to).toBe("2026-02-28");
    expect(shiftQuincena("2026-10-2", 1).from).toBe("2026-11-01");
    expect(shiftQuincena("2026-01-1", -1).from).toBe("2025-12-16");
  });
  it("tipos de checada", () => {
    expect(normalizePunchKind("Entrada")).toBe("entrada");
    expect(normalizePunchKind("Salida a comer")).toBe("salida_comida");
    expect(normalizePunchKind("Regreso de comer")).toBe("regreso_comida");
    expect(normalizePunchKind("Salida")).toBe("salida");
  });
});

describe("cálculo de asistencia", () => {
  const emp = { entryTime: "10:00", workdays: [1, 2, 3, 4, 5, 6], lunchMinutes: 60, punchesPerDay: 4, hireDate: null, endDate: null, dailySalary: 320 };
  // Semana lun 19 – dom 25 oct 2026
  const punches = [
    { at: at("2026-10-19T09:58:00") }, { at: at("2026-10-19T14:00:00") }, { at: at("2026-10-19T15:15:00") }, { at: at("2026-10-19T19:00:00") }, // a tiempo, comida 75 → 15 extra
    { at: at("2026-10-20T10:07:30") }, // 7 min tarde (tolerancia 0)
    // 21: falta
    // 22: justificada
    { at: at("2026-10-23T10:00:59") }, // 0 min (no completa minuto)
    { at: at("2026-10-24T11:00:00"), kind: "salida" }, { at: at("2026-10-24T10:30:00"), kind: "entrada" }, // usa la de tipo entrada: 30 min
    { at: at("2026-10-25T10:20:00") }, // domingo: descanso
  ];
  const r = computeAttendance(emp, punches, new Map([["2026-10-22", "Permiso"]]), "2026-10-19", "2026-10-25", at("2026-10-26T12:00:00"));
  it("clasifica cada día", () => {
    expect(r.days.map((d) => d.status)).toEqual(["a_tiempo", "retardo", "falta", "justificada", "a_tiempo", "retardo", "descanso"]);
    expect(r.days[0]).toMatchObject({ entry: "09:58", lunchMinutes: 75, extraLunch: 15 });
    expect(r.days[1].lateMinutes).toBe(7);
    expect(r.days[5].lateMinutes).toBe(30);
  });
  it("suma la quincena y estima el descuento", () => {
    expect(r).toMatchObject({ workdays: 6, worked: 4, absences: 1, justified: 1, lateMinutes: 37, extraLunchMinutes: 15, lateDays: 2 });
    // 1 falta × 320 + (37 + 15) min × 40/h
    expect(r.discount).toBeCloseTo(320 + (52 / 60) * 40, 2);
  });
  it("hoy sin checar es pendiente, no falta; antes del ingreso no cuenta", () => {
    const x = computeAttendance({ ...emp, hireDate: new Date("2026-10-21T00:00:00Z") }, [], new Map(), "2026-10-19", "2026-10-25", at("2026-10-22T08:00:00"));
    expect(x.days.map((d) => d.status)).toEqual(["fuera", "fuera", "falta", "pendiente"]);
  });
});

describe("importación y reporte", () => {
  const base = 900000 + Number(String(Date.now()).slice(-4));
  afterAll(async () => {
    await prisma.justification.deleteMany({ where: { reason: `prueba-${base}` } });
    await prisma.employee.deleteMany({ where: { employeeNo: { in: [base, base + 1] } } });
    await prisma.$disconnect();
  });
  it("importa personal, checadas sin duplicar y calcula", async () => {
    expect(await importEmployees(prisma, [
      { employeeNo: base, name: "Prueba Uno", entryTime: "10:00", workdays: [1, 2, 3, 4, 5, 6], dailySalary: 300 },
      { employeeNo: base + 1, name: "Prueba Dos", entryTime: "09:00" },
    ])).toEqual({ created: 2, updated: 0 });
    expect(await importEmployees(prisma, [{ employeeNo: base, name: "Prueba Uno", phone: "5511112222" }])).toEqual({ created: 0, updated: 1 });
    const rows = [
      { employeeNo: base, at: at("2026-10-19T10:05:00"), externalId: `u-${base}-1` },
      { employeeNo: base, at: at("2026-10-20T09:59:00") },
      { employeeNo: 1, at: at("2026-10-20T09:59:00") }, // no existe (si no hay empleado 1)
    ];
    const r1 = await importPunches(prisma, rows);
    const r2 = await importPunches(prisma, rows);
    expect(r1.added).toBe(2);
    expect(r2).toMatchObject({ added: 0, duplicates: 2 });
    const e = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: base } });
    await addJustification(prisma, { date: "2026-10-21", employeeId: e.id, reason: `prueba-${base}` });
    const [rep] = await attendanceReport(prisma, "2026-10-19", "2026-10-21", [e.id], at("2026-10-26T12:00:00"));
    expect(rep.days.map((d) => d.status)).toEqual(["retardo", "a_tiempo", "justificada"]);
    expect(rep.lateMinutes).toBe(5);
    expect(rep.employee.phone).toBe("5511112222");
  });
});
