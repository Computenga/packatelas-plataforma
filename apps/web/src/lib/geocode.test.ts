import { describe, expect, it } from "vitest";
import { parsePhoton, withTypedNumber } from "./geocode";

const feature = (properties: Record<string, string>, coords: [number, number] = [-99.14, 19.41]) => ({
  geometry: { coordinates: coords },
  properties: { countrycode: "MX", ...properties },
});

describe("parsePhoton (formato real de Photon en CDMX)", () => {
  it("toma la colonia de locality y la ciudad de district", () => {
    const [r] = parsePhoton({
      features: [
        feature({ type: "house", osm_value: "yes", housenumber: "200", street: "Calle Durango", locality: "Colonia Roma Norte", district: "Ciudad de México", state: "Ciudad de México", postcode: "06700" }),
      ],
    });
    expect(r).toMatchObject({
      addressLine: "Calle Durango 200",
      neighborhood: "Colonia Roma Norte",
      city: "Ciudad de México",
      zip: "06700",
      lat: 19.41,
      lng: -99.14,
    });
    expect(r.label).toBe("Calle Durango 200, Colonia Roma Norte, Ciudad de México, 06700");
  });

  it("calle sin número: usa el nombre de la calle", () => {
    const [r] = parsePhoton({
      features: [feature({ type: "street", osm_value: "residential", name: "Calle Juan Lucas de Lassaga", locality: "Colonia Obrera", district: "Ciudad de México", state: "Ciudad de México", postcode: "06800" })],
    });
    expect(r.addressLine).toBe("Calle Juan Lucas de Lassaga");
    expect(r.neighborhood).toBe("Colonia Obrera");
  });

  it("incluye el nombre del lugar cuando es un comercio", () => {
    const [r] = parsePhoton({ features: [feature({ name: "Contramar", housenumber: "200", street: "Calle Durango", locality: "Colonia Roma Norte" })] });
    expect(r.label.startsWith("Contramar, Calle Durango 200")).toBe(true);
  });

  it("descarta resultados fuera de México y duplicados", () => {
    const r = parsePhoton({
      features: [
        feature({ street: "Main St", countrycode: "US" }),
        feature({ street: "Durango", locality: "Roma Norte" }),
        feature({ street: "Durango", locality: "Roma Norte" }),
      ],
    });
    expect(r).toHaveLength(1);
  });
});

describe("withTypedNumber", () => {
  it("agrega el número que escribió el usuario si la calle no lo trae", () => {
    expect(withTypedNumber("Calle Juan Lucas de Lassaga", "lassaga 54 obrera")).toBe("Calle Juan Lucas de Lassaga 54");
  });
  it("no confunde el código postal con el número", () => {
    expect(withTypedNumber("Calle Durango", "durango 06700")).toBe("Calle Durango");
  });
  it("no duplica si ya trae número", () => {
    expect(withTypedNumber("Calle Durango 200", "durango 200")).toBe("Calle Durango 200");
  });
});
