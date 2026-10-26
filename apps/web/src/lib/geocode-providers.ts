import "server-only";
import { BBOX, BIAS, parsePhoton, type GeoResult } from "./geocode";
import { googleAutocomplete, googlePlaceDetails } from "./geocode-google";

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
