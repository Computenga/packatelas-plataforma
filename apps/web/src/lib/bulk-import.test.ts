import { describe, expect, it } from "vitest";
import { geocodeQuery, parseTable, readRows } from "./bulk-import";

describe("parseTable", () => {
  it("lee lo pegado desde Excel (tabuladores)", () => {
    expect(parseTable("Nombre\tDirección\nAna\tCalle 1 #10\n\n")).toEqual([["Nombre", "Dirección"], ["Ana", "Calle 1 #10"]]);
  });
  it("lee CSV con comillas, comas internas y BOM", () => {
    const t = '﻿Destinatario,Dirección,Referencias\r\n"Pérez, Ana","Av. Juárez 5","Dice ""casa azul"""\r\n';
    expect(parseTable(t)).toEqual([["Destinatario", "Dirección", "Referencias"], ["Pérez, Ana", "Av. Juárez 5", 'Dice "casa azul"']]);
  });
  it("acepta punto y coma (Excel en español)", () => {
    expect(parseTable("nombre;calle\nBeto;Reforma 222")[1]).toEqual(["Beto", "Reforma 222"]);
  });
});

describe("readRows", () => {
  it("reconoce encabezados con o sin acentos y valida cada renglón", () => {
    const { rows, error, unknown } = readRows(parseTable(
      "DESTINATARIO\tTelefono\tCalle\tColonia\tC.P.\tAlcaldia\tLatitud\tLongitud\tExtra\n" +
      "Ana López\t55 1234 5678\tLago Zurich 245\tAmpliación Granada\t11529\tMiguel Hidalgo\t19.44\t-99.20\tx\n" +
      "\t\tCalle sin nombre 1\t\t6800\t\t\t\t\n" +
      "Beto\t12\tAv. Siempre Viva 742\t\t123\t\t99\t-99\t\n",
    ));
    expect(error).toBeUndefined();
    expect(unknown).toEqual(["Extra"]);
    expect(rows[0]).toMatchObject({ line: 2, errors: [], data: { recipientName: "Ana López", zip: "11529", lat: 19.44, lng: -99.2, city: "Miguel Hidalgo" } });
    expect(rows[1].data.zip).toBe("06800");
    expect(rows[1].errors).toEqual(["Falta destinatario"]);
    expect(rows[2].errors).toEqual(["CP inválido", "Teléfono inválido", "Coordenadas inválidas"]);
  });
  it("sin columna de dirección no se puede cargar", () => {
    expect(readRows([["nombre"], ["Ana"]]).error).toMatch(/Dirección/);
  });
  it("arma la búsqueda del mapa", () => {
    expect(geocodeQuery({ addressLine: "Reforma 222", neighborhood: "Juárez", zip: "06600" })).toBe("Reforma 222, Juárez, 06600, México");
  });
});
