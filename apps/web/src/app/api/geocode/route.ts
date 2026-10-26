import { getSessionUser } from "@/lib/session";
import type { GeoResult } from "@/lib/geocode";
import { searchAddress } from "@/lib/geocode-providers";

// Caché en memoria para OpenStreetMap (Google prohíbe guardar sus resultados, no se cachean).
const cache = new Map<string, { at: number; results: GeoResult[] }>();
const TTL_MS = 24 * 3600_000;
const MAX_CACHE = 2000;
const lastCall = new Map<string, number>();

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 150);
  const session = (params.get("session") ?? "").slice(0, 64) || crypto.randomUUID();
  if (q.length < 4) return Response.json({ results: [] });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json({ results: hit.results, provider: "osm" });

  const now = Date.now();
  if (now - (lastCall.get(user.id) ?? 0) < 300) return Response.json({ results: [], throttled: true });
  lastCall.set(user.id, now);

  try {
    const { results, provider } = await searchAddress(q, session);
    if (provider === "osm") {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: now, results });
    }
    return Response.json({ results, provider });
  } catch {
    return Response.json({ results: [], error: "El buscador de direcciones no respondió; captura la dirección a mano." }, { status: 502 });
  }
}
