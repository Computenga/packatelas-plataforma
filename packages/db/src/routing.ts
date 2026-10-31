// Orden de paradas [A08, R02]. Sin servicios externos: vecino más cercano + mejoras 2-opt/or-opt
// sobre distancias en línea recta. Con OSRM disponible se usa su matriz de tiempos reales.

export type Point = { lat: number; lng: number };

/** Distancia en metros (fórmula de haversine). */
export function haversine(a: Point, b: Point): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Matriz de costos; índice 0 = punto de partida. */
export type Matrix = number[][];

export function straightLineMatrix(start: Point, stops: Point[]): Matrix {
  const pts = [start, ...stops];
  return pts.map((a) => pts.map((b) => haversine(a, b)));
}

function pathCost(m: Matrix, order: number[]): number {
  let c = 0;
  let prev = 0;
  for (const i of order) {
    c += m[prev][i];
    prev = i;
  }
  return c;
}

/**
 * Devuelve el orden de visita (índices de `stops`) que minimiza el recorrido
 * saliendo de `start`, sin regresar (ruta abierta).
 */
export function optimizeOrder(m: Matrix): number[] {
  const n = m.length - 1;
  if (n <= 1) return n === 1 ? [0] : [];

  // Vecino más cercano
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
  const order: number[] = [];
  let cur = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const j of left) {
      if (m[cur][j] < bestD) {
        bestD = m[cur][j];
        best = j;
      }
    }
    order.push(best);
    left.delete(best);
    cur = best;
  }

  // Mejoras locales mientras reduzcan el costo:
  // 2-opt (invertir un tramo) y or-opt (mover una parada a otra posición).
  let improved = true;
  let guard = 0;
  const tryCandidate = (candidate: number[]) => {
    if (pathCost(m, candidate) + 1e-6 < pathCost(m, order)) {
      order.splice(0, order.length, ...candidate);
      improved = true;
    }
  };
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        tryCandidate([...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)]);
      }
    }
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        if (i === j) continue;
        const rest = order.filter((_, x) => x !== i);
        tryCandidate([...rest.slice(0, j), order[i], ...rest.slice(j)]);
      }
    }
  }
  return order.map((i) => i - 1);
}

/** Matriz de tiempos reales (segundos) con OSRM `table`, o null si no está configurado/falla. */
export async function osrmMatrix(start: Point, stops: Point[], baseUrl = process.env.OSRM_URL): Promise<Matrix | null> {
  if (!baseUrl || stops.length === 0) return null;
  const coords = [start, ...stops].map((p) => `${p.lng},${p.lat}`).join(";");
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/table/v1/driving/${coords}?annotations=duration`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { durations?: (number | null)[][] };
    if (!json.durations) return null;
    return json.durations.map((row) => row.map((v) => (v == null ? 1e9 : v)));
  } catch {
    return null;
  }
}

/**
 * Afina el orden con TomTom (tráfico en vivo, modo moto): mantiene fija la última parada y
 * reordena las intermedias con `computeBestOrder`. Devuelve el nuevo orden (índices de `stops`)
 * y los segundos de manejo hasta cada parada, o null si no está configurado o falla.
 */
export async function tomtomRefine(start: Point, stops: Point[], key = process.env.TOMTOM_API_KEY?.trim(), fetchImpl: typeof fetch = fetch): Promise<{ order: number[]; etaSeconds: number[] } | null> {
  if (!key || stops.length === 0 || stops.length > 120) return null;
  const locs = [start, ...stops].map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(":");
  const qs = new URLSearchParams({
    key,
    traffic: "true",
    departAt: "now",
    travelMode: "motorcycle",
    routeType: "fastest",
    routeRepresentation: "summaryOnly",
    ...(stops.length >= 3 ? { computeBestOrder: "true" } : {}),
  });
  try {
    const res = await fetchImpl(`https://api.tomtom.com/routing/1/calculateRoute/${locs}/json?${qs}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      optimizedWaypoints?: { providedIndex: number; optimizedIndex: number }[];
      routes?: { legs?: { summary?: { travelTimeInSeconds?: number } }[] }[];
    };
    const legs = j.routes?.[0]?.legs ?? [];
    if (legs.length !== stops.length) return null;
    // optimizedWaypoints se refiere solo a las intermedias (sin origen ni destino final).
    const mid = stops.length - 1;
    const order = Array.from({ length: stops.length }, (_, i) => i);
    if (j.optimizedWaypoints?.length === mid) {
      for (const w of j.optimizedWaypoints) order[w.optimizedIndex] = w.providedIndex;
    }
    let acc = 0;
    const etaSeconds = legs.map((l) => (acc += l.summary?.travelTimeInSeconds ?? 0));
    return { order, etaSeconds };
  } catch {
    return null;
  }
}

// Pequeño caché para no pedirle a TomTom la misma ruta en cada recarga de la app.
const ttCache = new Map<string, { at: number; order: number[]; etaSeconds: number[] }>();

/** Ordena paradas desde la ubicación actual. Las que no tienen coordenadas van al final. */
export async function orderStops<T extends { lat: number | null; lng: number | null }>(
  start: Point | null,
  stops: T[],
): Promise<{ ordered: T[]; method: "tomtom" | "osrm" | "linea-recta" | "sin-ubicacion"; etaSeconds?: number[] }> {
  const located = stops.filter((s): s is T & Point => s.lat != null && s.lng != null);
  const rest = stops.filter((s) => s.lat == null || s.lng == null);
  if (!start || located.length === 0) return { ordered: stops, method: "sin-ubicacion" };
  const real = await osrmMatrix(start, located);
  const m = real ?? straightLineMatrix(start, located);
  const idx = optimizeOrder(m);
  const base = idx.map((i) => located[i]);
  // Con TomTom: tráfico en vivo y tiempos de llegada.
  if (process.env.TOMTOM_API_KEY) {
    const key = [start.lat.toFixed(3), start.lng.toFixed(3), ...base.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)].join("|");
    const hit = ttCache.get(key);
    const tt = hit && Date.now() - hit.at < 5 * 60_000 ? hit : await tomtomRefine(start, base);
    if (tt) {
      if (!hit) {
        if (ttCache.size > 500) ttCache.clear();
        ttCache.set(key, { at: Date.now(), ...tt });
      }
      return { ordered: [...tt.order.map((i) => base[i]), ...rest], method: "tomtom", etaSeconds: tt.etaSeconds };
    }
  }
  return { ordered: [...base, ...rest], method: real ? "osrm" : "linea-recta" };
}
