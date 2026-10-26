import { getSessionUser } from "@/lib/session";
import { searchAddress, type GeoResult } from "@/lib/geocode";

// Caché en memoria: las mismas búsquedas se repiten mucho y el proveedor gratuito limita uso.
const cache = new Map<string, { at: number; results: GeoResult[] }>();
const TTL_MS = 24 * 3600_000;
const MAX_CACHE = 2000;

// Límite por usuario: 1 búsqueda cada 400 ms (el buscador ya espera a que dejen de teclear).
const lastCall = new Map<string, number>();

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 150);
  if (q.length < 4) return Response.json({ results: [] });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json({ results: hit.results });

  const now = Date.now();
  if (now - (lastCall.get(user.id) ?? 0) < 400) return Response.json({ results: [], throttled: true });
  lastCall.set(user.id, now);

  try {
    const results = await searchAddress(q);
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now, results });
    return Response.json({ results });
  } catch {
    return Response.json({ results: [], error: "El buscador de direcciones no respondió; captura la dirección a mano." }, { status: 502 });
  }
}
