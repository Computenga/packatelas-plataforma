import { describe, expect, it } from "vitest";
import { parseGooglePlace, parseGoogleSuggestions } from "./geocode-google";

describe("Google Places (New)", () => {
  it("convierte sugerencias en resultados con placeId", () => {
    const r = parseGoogleSuggestions({
      suggestions: [
        {
          placePrediction: {
            placeId: "ChIJabc123def456",
            text: { text: "Calle Durango 200, Roma Nte., Cuauhtémoc, CDMX, México" },
            structuredFormat: { mainText: { text: "Calle Durango 200" }, secondaryText: { text: "Roma Nte., CDMX" } },
          },
        },
        {},
      ],
    });
    expect(r).toEqual([
      { label: "Calle Durango 200, Roma Nte., Cuauhtémoc, CDMX, México", addressLine: "Calle Durango 200", placeId: "ChIJabc123def456" },
    ]);
  });

  it("arma la dirección con los componentes del detalle", () => {
    const r = parseGooglePlace(
      {
        formattedAddress: "C. Durango 200, Roma Nte., Cuauhtémoc, 06700 Ciudad de México, CDMX, México",
        location: { latitude: 19.41952, longitude: -99.16717 },
        addressComponents: [
          { longText: "200", types: ["street_number"] },
          { longText: "Calle Durango", types: ["route"] },
          { longText: "Roma Norte", types: ["sublocality_level_1", "sublocality", "political"] },
          { longText: "Cuauhtémoc", types: ["locality", "political"] },
          { longText: "Ciudad de México", types: ["administrative_area_level_1", "political"] },
          { longText: "06700", types: ["postal_code"] },
        ],
      },
      "ChIJabc123def456",
    );
    expect(r).toMatchObject({
      addressLine: "Calle Durango 200",
      neighborhood: "Roma Norte",
      city: "Cuauhtémoc",
      state: "Ciudad de México",
      zip: "06700",
      lat: 19.41952,
      lng: -99.16717,
    });
  });

  it("sin ubicación no devuelve resultado", () => {
    expect(parseGooglePlace({ formattedAddress: "x" }, "id")).toBeNull();
  });
});

describe("parseGoogleGeocode", () => {
  it("marca preciso solo a nivel de número de casa", async () => {
    const { parseGoogleGeocode } = await import("./geocode-google");
    const r = (location_type: string, partial_match?: boolean) => ({
      status: "OK",
      results: [{ formatted_address: "X", partial_match, geometry: { location: { lat: 19.4, lng: -99.1 }, location_type } }],
    });
    expect(parseGoogleGeocode(r("ROOFTOP"))?.precise).toBe(true);
    expect(parseGoogleGeocode(r("ROOFTOP", true))?.precise).toBe(false);
    expect(parseGoogleGeocode(r("APPROXIMATE"))).toMatchObject({ lat: 19.4, precise: false });
    expect(parseGoogleGeocode({ status: "ZERO_RESULTS" })).toBeNull();
  });
});
