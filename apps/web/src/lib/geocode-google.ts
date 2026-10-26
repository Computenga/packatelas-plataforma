// Google Places API (New): autocompletado por sesión + detalle de la dirección elegida.
// Se cobra por sesión (todas las teclas + un detalle), con 5,000 sesiones gratis al mes.
import type { GeoResult } from "./geocode";

type Prediction = {
  placePrediction?: {
    placeId: string;
    text?: { text: string };
    structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
  };
};

export function parseGoogleSuggestions(json: { suggestions?: Prediction[] }): GeoResult[] {
  const out: GeoResult[] = [];
  for (const s of json.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
    out.push({ label: p.text?.text ?? main, addressLine: main, placeId: p.placeId });
  }
  return out;
}

type Component = { longText: string; shortText?: string; types: string[] };
type PlaceDetails = {
  formattedAddress?: string;
  addressComponents?: Component[];
  location?: { latitude: number; longitude: number };
};

export function parseGooglePlace(place: PlaceDetails, placeId: string): GeoResult | null {
  if (!place.location) return null;
  const get = (...types: string[]) =>
    place.addressComponents?.find((c) => types.some((t) => c.types.includes(t)))?.longText;
  const route = get("route");
  const number = get("street_number");
  const addressLine = [route, number].filter(Boolean).join(" ") || place.formattedAddress?.split(",")[0] || "";
  return {
    label: place.formattedAddress ?? addressLine,
    addressLine,
    neighborhood: get("sublocality_level_1", "sublocality", "neighborhood"),
    city: get("locality", "administrative_area_level_2"),
    state: get("administrative_area_level_1"),
    zip: get("postal_code"),
    lat: place.location.latitude,
    lng: place.location.longitude,
    placeId,
  };
}

const RECT = { low: { latitude: 18.85, longitude: -99.75 }, high: { latitude: 20.05, longitude: -98.55 } };

export async function googleAutocomplete(q: string, sessionToken: string, key: string): Promise<GeoResult[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input: q,
      sessionToken,
      includedRegionCodes: ["mx"],
      languageCode: "es-419",
      locationBias: { rectangle: RECT },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Google autocomplete ${res.status}`);
  return parseGoogleSuggestions(await res.json());
}

/** Cierra la sesión de autocompletado: un solo detalle por sesión (campos de nivel Essentials). */
export async function googlePlaceDetails(placeId: string, sessionToken: string, key: string): Promise<GeoResult | null> {
  if (!/^[\w-]{10,300}$/.test(placeId)) return null;
  const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
  url.searchParams.set("sessionToken", sessionToken);
  url.searchParams.set("languageCode", "es-419");
  const res = await fetch(url, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "formattedAddress,addressComponents,location" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Google details ${res.status}`);
  return parseGooglePlace(await res.json(), placeId);
}
