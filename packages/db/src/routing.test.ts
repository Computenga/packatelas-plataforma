import { describe, expect, it } from "vitest";
import { haversine, optimizeOrder, orderStops, straightLineMatrix } from "./routing.ts";

describe("rutas", () => {
  it("haversine: Zócalo → Ángel de la Independencia ≈ 3.4 km", () => {
    const d = haversine({ lat: 19.4326, lng: -99.1332 }, { lat: 19.4270, lng: -99.1677 });
    expect(d).toBeGreaterThan(3300);
    expect(d).toBeLessThan(3800);
  });

  it("ordena paradas sobre una línea sin zigzag", () => {
    // Paradas a lo largo de una avenida, revueltas.
    const start = { lat: 19.40, lng: -99.20 };
    const stops = [5, 1, 4, 2, 3].map((k) => ({ lat: 19.40, lng: -99.20 + k * 0.01, k }));
    const idx = optimizeOrder(straightLineMatrix(start, stops));
    expect(idx.map((i) => stops[i].k)).toEqual([1, 2, 3, 4, 5]);
  });

  it("las mejoras locales corrigen al vecino más cercano", () => {
    const start = { lat: 0, lng: 0 };
    const stops = [
      { lat: 0, lng: 1 },
      { lat: 0, lng: -1.1 },
      { lat: 0, lng: 2 },
    ];
    const m = straightLineMatrix(start, stops);
    const idx = optimizeOrder(m);
    // Mejor: ir primero al lado corto (-1.1) y luego barrer hacia +2 → costo 1.1 + 2.1 + 1 = 4.2
    // vs. vecino más cercano 1 → 2 → -1.1 = 1 + 1 + 3.1 = 5.1
    expect(idx).toEqual([1, 0, 2]);
  });

  it("sin ubicación de partida conserva el orden; sin coordenadas van al final", async () => {
    const stops = [
      { id: "a", lat: null, lng: null },
      { id: "b", lat: 19.41, lng: -99.14 },
      { id: "c", lat: 19.42, lng: -99.13 },
    ];
    expect((await orderStops(null, stops)).ordered.map((s) => s.id)).toEqual(["a", "b", "c"]);
    const r = await orderStops({ lat: 19.425, lng: -99.125 }, stops);
    expect(r.ordered.map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(r.method).toBe("linea-recta");
  });
});
