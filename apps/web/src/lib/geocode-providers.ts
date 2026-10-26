import "server-only";
import { BBOX, BIAS, parsePhoton, type GeoResult } from "./geocode";
import { googleAutocomplete, googleGeocode, googlePlaceDetails, type GeocodeHit } from "./geocode-google";

async function photon(q: string): Promise<GeoResult[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("bbox", BBOX);
  url.searchParams.set("lat", String(BIAS.lat));
  url.searchParams.set("lon", String(BIAS.lon));
  const res = await fetch(url, {
    headers: { "User-Agent": "Packatelas-Plataforma/1.0 (operacion@packatelas.mx)" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return parsePhoton(await res.json());
}

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY?.trim() || undefined;

/** Google si hay llave configurada; si no, o si Google falla, OpenStreetMap (Photon). */
export async function searchAddress(q: string, sessionToken: string): Promise<{ results: GeoResult[]; provider: string }> {
  const key = googleKey();
  if (key) {
    try {
      return { results: await googleAutocomplete(q, sessionToken, key), provider: "google" };
    } catch (e) {
      console.error("[geocode] Google falló, uso OpenStreetMap:", e);
    }
  }
  return { results: await photon(q), provider: "osm" };
}

export async function placeDetails(placeId: string, sessionToken: string): Promise<GeoResult | null> {
  const key = googleKey();
  if (!key) return null;
  return googlePlaceDetails(placeId, sessionToken, key);
}

const inZone = (lat: number, lng: number) => lat >= 18.85 && lat <= 20.05 && lng >= -99.75 && lng <= -98.55;

/**
 * Coordenadas para la carga masiva [A03]. Google Geocoding si hay llave (y la API está activa);
 * si no, o si falla, OpenStreetMap. Fuera de CDMX/Edomex se descarta.
 */
export async function geocodeAddress(address: string): Promise<(GeocodeHit & { provider: string }) | null> {
  const key = googleKey();
  if (key) {
    try {
      const hit = await googleGeocode(address, key);
      if (hit && inZone(hit.lat, hit.lng)) return { ...hit, provider: "google" };
      if (hit) return null;
    } catch (e) {
      console.error("[geocode] Google Geocoding falló, uso OpenStreetMap:", e);
    }
  }
  try {
    const [first] = await photon(address);
    if (first?.lat == null || first.lng == null || !inZone(first.lat, first.lng)) return null;
    return { lat: first.lat, lng: first.lng, precise: /\d/.test(first.addressLine), label: first.label, provider: "osm" };
  } catch {
    return null;
  }
}
