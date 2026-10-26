import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import PizZip from "pizzip";
import { bajaPackage, generateBaja, generateIngreso, type BajaInput } from "./rh-docs";
import { EMPRESA_DEFAULT, numeroALetras, suggestFiniquito } from "./rh-text";

const text = (buf: Buffer) => new PizZip(buf).file("word/document.xml")!.asText().replace(/<[^>]+>/g, "");
const baja: BajaInput = {
  nombre: "Juan Pérez Gómez", curp: "pegj950101hdfrmn09", ingreso: "2025-03-01", baja: "2026-10-15", salario: 400, tipo: "despido",
  finiquito: { diasSal: 5, diasVac: 3.5, diasAgu: 11.8, deducciones: [{ concepto: "Llanta", importe: 300 }], fechaAviso: "2026-10-14" },
  rescision: { causas: [{ fraccion: "X", narrativa: "Faltó 4 días sin justificar del 1 al 8 de octubre." }] },
};

describe("documentos RH", () => {
  it("convierte montos a letra", () => {
    expect(numeroALetras(1)).toBe("Uno peso 00/100 M.N.".replace("Uno", "Un"));
    expect(numeroALetras(21.5)).toBe("Veintiún pesos 50/100 M.N.");
    expect(numeroALetras(1234567.89)).toBe("Un millón doscientos treinta y cuatro mil quinientos sesenta y siete pesos 89/100 M.N.");
  });
  it("sugiere vacaciones y aguinaldo proporcionales", () => {
    expect(suggestFiniquito("2025-03-01", "2026-10-15")).toMatchObject({ vacDays: expect.any(Number), aguDays: expect.any(Number) });
  });
  it("llena cada plantilla sin dejar marcadores", async () => {
    for (const d of ["constancia", "confidencialidad", "renuncia", "finiquito", "rescision"] as const) {
      const t = text(generateBaja(d, baja).data);
      expect(t, d).toContain("JUAN PÉREZ GÓMEZ");
      expect(t, d).not.toMatch(/\[[A-Z_ÁÉÍÓÚÑ0-9]+\]/);
    }
    const fin = text(generateBaja("finiquito", baja).data);
    expect(fin).toContain("Llanta");
    expect(text(generateBaja("rescision", baja).data)).toContain("Faltó 4 días");
    for (const d of ["contrato", "anexo_a"] as const) {
      const t = text(generateIngreso(d, EMPRESA_DEFAULT, { nombre: "Ana Ruiz", esRepartidor: true, fechaInicio: "2026-11-01", salario: 350, motoPropia: true, pruebaDias: 30 }).data);
      expect(t, d).toContain("ANA RUIZ");
      expect(t, d).not.toMatch(/\[[A-Z_ÁÉÍÓÚÑ0-9]+\]/);
    }
    const pkg = await bajaPackage(baja);
    expect(Object.keys(new PizZip(pkg.data).files)).toHaveLength(4);
  });
});
