// Búsqueda de direcciones [A03]. Proveedor gratuito (Photon sobre OpenStreetMap) por ahora;
// la interfaz permite cambiar a Google Places sin tocar las pantallas.

export type GeoResult = {
  label: string;
  addressLine: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat: number;
  lng: number;
};

// Zona de operación: CDMX y Estado de México (lng mín, lat mín, lng máx, lat máx).
const BBOX = "-99.75,18.85,-98.55,20.05";
const BIAS = { lat: 19.4326, lon: -99.1332 };

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
    osm_value?: string;
  };
};

export function parsePhoton(json: { features?: PhotonFeature[] }): GeoResult[] {
  const out: GeoResult[] = [];
  const seen = new Set<string>();
  for (const f of json.features ?? []) {
    const p = f.properties;
    if (p.countrycode && p.countrycode.toUpperCase() !== "MX") continue;
    const street = [p.street ?? (p.osm_value === "house" ? undefined : p.name), p.housenumber].filter(Boolean).join(" ");
    const addressLine = street || p.name || "";
    if (!addressLine) continue;
    // En México, OSM/Photon suele traer la colonia en `locality` y la ciudad en `district`.
    const neighborhood = p.locality ?? (p.district !== p.state ? p.district : undefined);
    const city = p.city ?? p.county ?? (p.locality ? p.district : undefined);
    const label = [p.name && p.name !== street ? p.name : undefined, addressLine, neighborhood, city, p.postcode]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(", ");
    if (seen.has(label)) continue;
    seen.add(label);
    const [lng, lat] = f.geometry.coordinates;
    out.push({ label, addressLine, neighborhood, city, state: p.state, zip: p.postcode, lat, lng });
  }
  return out;
}

/**
 * OSM rara vez tiene números de casa en México: si la sugerencia es solo la calle y el usuario
 * escribió un número (1–4 dígitos, no un CP), se lo agregamos.
 */
export function withTypedNumber(addressLine: string, query: string): string {
  if (/\d/.test(addressLine)) return addressLine;
  const m = query.match(/(?:^|\s|#)(\d{1,4}[a-zA-Z]?)(?=\s|,|$)/);
  return m ? `${addressLine} ${m[1].toUpperCase()}` : addressLine;
}

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

/** Busca direcciones con el proveedor configurado (GEOCODER=photon por defecto). */
export async function searchAddress(q: string): Promise<GeoResult[]> {
  const provider = process.env.GEOCODER ?? "photon";
  switch (provider) {
    case "photon":
      return photon(q);
    default:
      throw new Error(`Proveedor de direcciones no soportado: ${provider}`);
  }
}
