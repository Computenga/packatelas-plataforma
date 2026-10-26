import { describe, expect, it } from "vitest";
import { parseClock, parseWorkdays, normalizePunchKind } from "@packatelas/db/attendance";
import { parseEmployees, parsePunches } from "./personnel-import";

describe("parseEmployees", () => {
  it("lee la pestaña Personal e ignora PIN y llaves", () => {
    const r = parseEmployees(
      "no_empleado\tnombre\trfc\testatus\tfecha_ingreso\tsalario_diario\thora_entrada\tdias_laborales\tminutos_comida\tchecadas\tpin_hash\n" +
      "7\tAna Prueba\taaaa800101xx1\tactivo\t05/10/2026\t$320.00\t10:00\tL-S\t60\t4\tSECRETO\n" +
      "8\tBeto Baja\t\tbaja\t2025-01-02\t\t9\t1,2,3,4,5\t\t2\t\n" +
      "\tSin número\t\t\t\t\t\t\t\t\t\n",
      { workdays: parseWorkdays, clock: parseClock },
    );
    expect(r.ignored).toContain("pin_hash");
    expect(r.errors).toHaveLength(1);
    expect(r.rows[0]).toEqual({
      employeeNo: 7, name: "Ana Prueba", rfc: "aaaa800101xx1", status: "ACTIVO", hireDate: "2026-10-05", dailySalary: 320,
      entryTime: "10:00", workdays: [1, 2, 3, 4, 5, 6], lunchMinutes: 60, punchesPerDay: 4,
    });
    expect(JSON.stringify(r.rows)).not.toContain("SECRETO");
    expect(r.rows[1]).toMatchObject({ employeeNo: 8, status: "BAJA", hireDate: "2025-01-02", entryTime: "09:00", workdays: [1, 2, 3, 4, 5], punchesPerDay: 2 });
  });
});

describe("parsePunches", () => {
  it("pestaña Checadas (fecha y hora separadas, con tipo y UUID)", () => {
    const r = parsePunches("UUID\tFecha\tHora\tNo. empleado\tNombre\tTipo\tSimilitud\tDispositivo\n" +
      "abc-1\t20/10/2026\t10:05:12\t7\tAna\tEntrada\t\tZKTeco\n" +
      "abc-2\t2026-10-20\t2:01 pm\t7\tAna\tSalida a comer\t\tZKTeco\n", normalizePunchKind);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ employeeNo: 7, kind: "entrada", device: "ZKTeco", externalId: "abc-1" });
    expect(r.rows[0].at.toISOString()).toBe("2026-10-20T16:05:12.000Z");
    expect(r.rows[1]).toMatchObject({ kind: "salida_comida" });
    expect(r.rows[1].at.toISOString()).toBe("2026-10-20T20:01:00.000Z");
  });
  it("CSV del reloj con fecha/hora juntas", () => {
    const r = parsePunches("No.,Fecha/Hora,Estado\n12,2026-10-21 09:59:30,Check-in\n", normalizePunchKind);
    expect(r.rows[0]).toMatchObject({ employeeNo: 12, kind: "entrada" });
  });
});
