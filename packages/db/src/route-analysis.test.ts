import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeDay, DEPOT, prisma, routeAnalysis, summarize, type DayStop } from "./index.ts";

const at = (s: string) => new Date(`${s}-06:00`);
const stop = (i: number, lat: number, lng: number, t: string, loaded?: string): DayStop => ({
  orderId: `o${i}`, code: `TEST-${i}`, lat, lng, deliveredAt: at(t), loadedAt: loaded ? at(loaded) : null,
});
const opts = { serviceMinutes: 10, fromHour: 15, depot: DEPOT, osrmUrl: "" };

describe("análisis de tiempos de ruta", () => {
  afterAll(() => prisma.$disconnect());

  it("esperado = manejo en orden óptimo + 10 min por parada; real desde la salida", async () => {
    const stops = [
      stop(1, 19.43, -99.13, "2026-10-20T16:10:00", "2026-10-20T15:20:00"),
      stop(2, 19.44, -99.12, "2026-10-20T16:40:00"),
      stop(3, 19.45, -99.11, "2026-10-20T17:20:00"),
    ];
    const d = (await analyzeDay({ driverId: "d1", driver: "Ficticio", day: "2026-10-20" }, stops, opts))!;
    expect(d.method).toBe("linea-recta");
    expect(d.stops).toBe(3);
    expect(d.start.toISOString()).toBe(at("2026-10-20T15:20:00").toISOString()); // salió al cargar
    expect(d.actualMinutes).toBe(120);
    expect(d.expectedMinutes).toBe(d.driveMinutes + 30);
    expect(d.driveMinutes).toBeGreaterThan(5);
    expect(d.driveMinutes).toBeLessThan(30);
  });

  it("sin escaneo de carga la salida es a las 15:00 y se ignoran destinos en la bodega", async () => {
    const stops = [stop(1, DEPOT.lat, DEPOT.lng, "2026-10-20T15:30:00"), stop(2, 19.43, -99.13, "2026-10-20T16:00:00")];
    const d = (await analyzeDay({ driverId: "d1", driver: "Ficticio", day: "2026-10-20" }, stops, opts))!;
    expect(d.stops).toBe(1);
    expect(d.actualMinutes).toBe(60);
  });

  it("el resumen ordena por quién se tarda más y calcula entregas por hora", () => {
    const base = { start: new Date(), firstDelivery: new Date(), lastDelivery: new Date(), driveMinutes: 0, method: "osrm" as const, skippedNoLocation: 0 };
    const s = summarize([
      { ...base, driverId: "a", driver: "A", day: "2026-10-20", stops: 10, expectedMinutes: 100, actualMinutes: 120 },
      { ...base, driverId: "a", driver: "A", day: "2026-10-21", stops: 10, expectedMinutes: 100, actualMinutes: 90 },
      { ...base, driverId: "b", driver: "B", day: "2026-10-20", stops: 6, expectedMinutes: 60, actualMinutes: 90 },
    ]);
    expect(s.map((x) => x.driver)).toEqual(["B", "A"]);
    expect(s[1]).toMatchObject({ days: 2, stops: 20, ratio: 1.05, perHour: 5.7, extraMinutes: 20 });
  });

  it("la consulta corre sobre la base", async () => {
    const r = await routeAnalysis(prisma, { from: new Date(Date.now() - 7 * 86400_000), to: new Date() }, { osrmUrl: "" });
    expect(Array.isArray(r.days)).toBe(true);
  });
});
