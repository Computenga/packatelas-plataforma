import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, legacyDate, syncLegacy, type SheetReader } from "./index.ts";

const N1 = 9901, N2 = 9902;
const sheets: Record<string, string[][]> = {
  "Personal!A:AD": [["no_empleado", "nombre", "rfc", "estatus", "fecha_ingreso", "salario_diario", "telefono", "pin_hash"], [String(N1), "Ana Prueba", "LOAS840319IF1", "activo", "15/10/2026", "360.5", "5638468641", "secreto"], [String(N2), "Beto Prueba", "", "activo", "", "300", "", ""]],
  "Empleados!A:M": [["No. empleado", "Nombre", "Checadas", "Hora de entrada", "Días laborales", "Minutos de comida"], [String(N1), "Ana Prueba", "ENTRADA,SALIDA_COMIDA,REGRESO_COMIDA,SALIDA", "9:00", "L,M,Mi,J,V,S", "60"]],
  "Checadas!A:L": [["UUID", "Fecha", "Hora", "No. empleado", "Nombre", "Tipo"], ["11111111-aaaa-4bbb-8ccc-000000009901", "2026-10-09", "10:13:51", String(N1), "Ana", "ENTRADA"]],
  "Justificadas!A:D": [["Fecha", "No. empleado (vacío = todos)", "Motivo", "Nota"], ["2026-10-14", String(N2), "Justificada-test", "SOL-1"]],
  "Vehiculos!A:K": [["vehiculo_id", "placa", "marca", "modelo", "anio", "color", "num_serie", "km_actual", "estatus"], ["M-990", "", "ITALIKA", "FT250", "2026", "AZUL", "1", "20594", "activo"]],
  "Checks!A:O": [["check_id", "tipo", "fecha_hora", "usuario_id", "vehiculo_id", "km", "km_recorridos", "foto_1"], ["CH-T99001", "matutino", "13/10/2026 9:58:34", `U-${N1}`, "M-990", "271753", "", "https://drive.google.com/file/d/x/view"]],
  "Combustible!A:L": [["carga_id", "check_id", "fecha_hora", "usuario_id", "vehiculo_id", "km_recorridos", "monto", "litros"], ["CG-T99001", "CH-T99001", "14/10/2026 9:31:47", `U-${N1}`, "M-990", "", "101.03", "4.092"]],
  "Fallas!A:O": [["falla_id", "tipo", "check_id", "fecha_reporte", "reportada_por", "responsable_id", "vehiculo_id", "descripcion", "severidad", "foto_1", "foto_2", "foto_3", "foto_4", "estatus"], ["F-T99001", "normal", "CH-T99001", "13/10/2026 9:58:35", `U-${N1}`, `U-${N1}`, "M-990", "No sirve el velocímetro", "media", "", "", "", "", "abierta"]],
  "Reparaciones!A:U": [["rep_id", "falla_id", "vehiculo_id", "mecanico_id", "fecha_inicio", "fecha_cierre", "horas_respuesta", "horas_reparacion", "descripcion", "foto_1", "foto_2", "foto_3", "foto_4", "costo_refacciones", "costo_mano_obra", "costo_total", "causa", "responsable_id", "monto_empleado", "monto_empresa"], ["R-T99001", "F-T99001", "M-990", "U-62", "26/10/2026 14:42:17", "26/10/2026", "", "", "Cambio de cadena", "", "", "", "", "261", "0", "261", "desgaste", `U-${N1}`, "0", "261"]],
  "Recibos!A:T": [["recibo_id", "no_empleado", "nombre", "periodo", "desde", "hasta", "dias", "salario_diario", "sueldo", "bonos", "otras_percepciones", "desc_faltas", "desc_retardos", "desc_cargos", "desc_adeudos", "otras_deducciones", "total_percepciones", "total_deducciones", "neto", "detalle_json"], ["REC-T1", String(N1), "Ana", "2022-03-1", "01/03/2022", "15/03/2022", "15", "200", "3000", "100", "0", "200", "0", "0", "0", "0", "3100", "200", "2900", "{\"notas\":\"histórico\"}"]],
  "DocsEmpleado!A:K": [["archivo_id", "owner", "doc_id", "nombre_archivo", "file_id", "mime", "fecha", "estatus"], ["A-T1", `E:${N1}`, "ine", "ine.pdf", "1AbCdEfGhIjKlMnOp_q", "application/pdf", "01/10/2026", "aprobado"]],
  "Documentos!A:J": [["doc_id", "vehiculo_id", "tipo", "folio", "fecha_emision", "vigencia"]],
};
const read: SheetReader = async (_id, range) => sheets[range] ?? [];

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { startsWith: "legacy.sync.snap." } } });
  const v = await prisma.vehicle.findUnique({ where: { code: "M-990" } });
  if (v) {
    await prisma.repair.deleteMany({ where: { vehicleId: v.id } });
    await prisma.fault.deleteMany({ where: { vehicleId: v.id } });
    await prisma.fuelLoad.deleteMany({ where: { vehicleId: v.id } });
    await prisma.vehicleCheck.deleteMany({ where: { vehicleId: v.id } });
    await prisma.vehicle.delete({ where: { id: v.id } });
  }
  const emps = (await prisma.employee.findMany({ where: { employeeNo: { in: [N1, N2] } }, select: { id: true } })).map((e) => e.id);
  await prisma.payrollReceipt.deleteMany({ where: { employeeId: { in: emps } } });
  await prisma.employeeDocument.deleteMany({ where: { employeeId: { in: emps } } });
  await prisma.employee.deleteMany({ where: { employeeNo: { in: [N1, N2] } } });
  await prisma.auditLog.deleteMany({ where: { action: "employees.imported", summary: { contains: "Personal importado" }, createdAt: { gte: new Date(Date.now() - 600_000) } } }).catch(() => {});
  await prisma.$disconnect();
});

describe("unificación con las hojas actuales [A37]", () => {
  it("lee fechas en ambos formatos (hora de CDMX)", () => {
    expect(legacyDate("13/10/2026 9:58:34")?.toISOString()).toBe("2026-10-13T15:58:34.000Z");
    expect(legacyDate("2026-10-14")?.toISOString()).toBe("2026-10-14T06:00:00.000Z");
  });

  it("copia empleados, checadas, justificadas y flotilla sin duplicar en la segunda vuelta", async () => {
    const r1 = await syncLegacy(prisma, read, { force: true });
    expect(r1.errors).toEqual([]);
    const ana = await prisma.employee.findUniqueOrThrow({ where: { employeeNo: N1 } });
    expect(ana.entryTime).toBe("09:00");
    expect(ana.punchesPerDay).toBe(4);
    expect(Number(ana.dailySalary)).toBe(360.5);
    expect(await prisma.punch.count({ where: { employeeId: ana.id } })).toBe(1);
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { code: "M-990" } });
    expect(v.km).toBe(20594);
    const f = await prisma.fault.findUniqueOrThrow({ where: { legacyId: "F-T99001" }, include: { repair: true } });
    expect(f.checkId).toBeTruthy();
    expect(Number(f.repair?.companyAmount)).toBe(261);
    const rec = await prisma.payrollReceipt.findFirstOrThrow({ where: { employeeId: ana.id, quincena: "2022-03-1" }, include: { lines: true } });
    expect(rec.status).toBe("PAGADO");
    expect(rec.lines.map((l) => [l.concept, Number(l.amount)])).toEqual([["Sueldo", 3000], ["Bonos", 100], ["Faltas", 200]]);
    const doc = await prisma.employeeDocument.findFirstOrThrow({ where: { employeeId: ana.id } });
    expect(doc.fileKey).toBe("drive:1AbCdEfGhIjKlMnOp_q");
    expect(doc.status).toBe("APROBADO");

    sheets["Fallas!A:O"][1][13] = "cerrada";
    const r2 = await syncLegacy(prisma, read, { force: true });
    expect(r2.results.checks).toBe("0 nuevos");
    expect(r2.results.fallas).toBe("0 nuevas, 1 con estatus actualizado");
    expect(r2.results.justificadas).toBe("0 nuevas");
    expect(r2.results.recibos).toBe("0 nuevos (1 en la hoja)");
    expect(r2.results.expedientes).toContain("0 documentos");
    expect(await prisma.punch.count({ where: { employeeId: ana.id } })).toBe(1);

    // Corrección en la hoja (hora −14 h y tipo puerta): se actualiza la misma checada, sin duplicar.
    sheets["Checadas!A:L"][1][2] = "08:13:51";
    sheets["Checadas!A:L"][1][5] = "ACCESO (puerta)";
    const r3 = await syncLegacy(prisma, read, { force: true });
    expect(r3.results.checadas).toContain("1 corregidas");
    const p = await prisma.punch.findFirstOrThrow({ where: { employeeId: ana.id } });
    expect(p.at.toISOString()).toBe("2026-10-09T14:13:51.000Z");
    expect(p.kind).toBe("acceso");
    expect(await prisma.punch.count({ where: { employeeId: ana.id } })).toBe(1);
  });

  it("no regresa al dato de la hoja lo que se editó en el portal; sí copia lo que cambió en la hoja", async () => {
    // Edición en el portal: moto a taller→activa y otro número de serie; teléfono del empleado.
    await prisma.vehicle.update({ where: { code: "M-990" }, data: { status: "TALLER", vin: "SERIE-PORTAL" } });
    await prisma.employee.update({ where: { employeeNo: N1 }, data: { phone: "5500000001" } });
    await syncLegacy(prisma, read, { force: true });
    expect(await prisma.vehicle.findUniqueOrThrow({ where: { code: "M-990" } })).toMatchObject({ status: "TALLER", vin: "SERIE-PORTAL" });
    expect((await prisma.employee.findUniqueOrThrow({ where: { employeeNo: N1 } })).phone).toBe("5500000001");
    // Cambio en la hoja (color y km): se copia solo eso.
    sheets["Vehiculos!A:K"][1][5] = "ROJO";
    sheets["Vehiculos!A:K"][1][7] = "21000";
    await syncLegacy(prisma, read, { force: true });
    expect(await prisma.vehicle.findUniqueOrThrow({ where: { code: "M-990" } })).toMatchObject({ status: "TALLER", vin: "SERIE-PORTAL", color: "ROJO", km: 21000 });
  });
});
