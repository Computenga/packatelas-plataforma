import { describe, expect, it } from "vitest";
import { canonicalMunicipio, municipioFromAddress } from "./municipios.ts";

describe("alcaldías y municipios", () => {
  it("normaliza lo escrito a mano", () => {
    expect(canonicalMunicipio("CUAUHTEMOC")).toEqual({ name: "Cuauhtémoc", zone: "cmx" });
    expect(canonicalMunicipio("Ecatepec de Morelos")).toEqual({ name: "Ecatepec", zone: "emx" });
    expect(canonicalMunicipio("cuautitlan izcalli")).toEqual({ name: "Cuautitlán Izcalli", zone: "emx" });
    expect(canonicalMunicipio("GAM")?.name).toBe("Gustavo A. Madero");
    expect(canonicalMunicipio("Neza")?.name).toBe("Nezahualcóyotl");
    expect(canonicalMunicipio("Pachuca")).toEqual({ name: "Pachuca", zone: null });
    expect(canonicalMunicipio("  ")).toBeNull();
  });
  it("encuentra el municipio dentro de una dirección", () => {
    expect(municipioFromAddress("Juan Lucas de Lassaga 54, Col. Obrera, Cuauhtémoc, 06800")?.name).toBe("Cuauhtémoc");
    expect(municipioFromAddress("Av. Palomas Mz A, Llano de los Báez, Ecatepec de Morelos, Edo. Méx.")?.name).toBe("Ecatepec");
    expect(municipioFromAddress("Calle La Paz 12, Centro")).toBeNull();
    expect(municipioFromAddress("Valle de Chalco Solidaridad")?.name).toBe("Valle de Chalco");
  });
});
