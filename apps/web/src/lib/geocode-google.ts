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

export type GeocodeHit = { lat: number; lng: number; precise: boolean; label: string };

type GeocodeJson = {
  status: string;
  results?: { formatted_address: string; partial_match?: boolean; geometry: { location: { lat: number; lng: number }; location_type: string } }[];
};

/** Resultado de la Geocoding API; "preciso" = a nivel de número de casa y sin coincidencia parcial. */
export function parseGoogleGeocode(json: GeocodeJson): GeocodeHit | null {
  const r = json.status === "OK" ? json.results?.[0] : undefined;
  if (!r) return null;
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    precise: ["ROOFTOP", "RANGE_INTERPOLATED"].includes(r.geometry.location_type) && !r.partial_match,
    label: r.formatted_address,
  };
}

/** Geocoding API (carga masiva): 10,000 búsquedas gratis al mes; requiere activar "Geocoding API" en la llave. */
export async function googleGeocode(address: string, key: string): Promise<GeocodeHit | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:MX");
  url.searchParams.set("bounds", `${RECT.low.latitude},${RECT.low.longitude}|${RECT.high.latitude},${RECT.high.longitude}`);
  url.searchParams.set("language", "es-419");
  url.searchParams.set("key", key);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Google geocode ${res.status}`);
  const json = (await res.json()) as GeocodeJson & { error_message?: string };
  if (json.status === "REQUEST_DENIED" || json.status === "OVER_QUERY_LIMIT") throw new Error(`Google geocode ${json.status}: ${json.error_message ?? ""}`);
  return parseGoogleGeocode(json);
}
