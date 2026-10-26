import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, classifyBurned, driverReport, deliveriesByHour, zoneReport } from "./index.ts";

const at = (s: string) => new Date(`${s}-06:00`);

describe("carga quemada", () => {
  const now = at("2026-10-28T12:00:00");
  it("llegó quemada si el compromiso es anterior al día de recepción", () => {
    expect(classifyBurned({ createdAt: at("2026-10-27T09:00:00"), requestedDeliveryAt: at("2026-10-26T18:00:00"), deliveredAt: null, status: "CREATED" }, now)).toBe("llego_quemada");
  });
  it("entrega tarde si llegó a tiempo y se entregó después del día compromiso", () => {
    expect(classifyBurned({ createdAt: at("2026-10-26T09:00:00"), requestedDeliveryAt: at("2026-10-26T20:00:00"), deliveredAt: at("2026-10-27T11:00:00"), status: "DELIVERED" }, now)).toBe("entrega_tarde");
    expect(classifyBurned({ createdAt: at("2026-10-26T09:00:00"), requestedDeliveryAt: at("2026-10-26T20:00:00"), deliveredAt: at("2026-10-26T22:30:00"), status: "DELIVERED" }, now)).toBeNull();
  });
  it("vencida si sigue sin entregarse pasado el día compromiso", () => {
    expect(classifyBurned({ createdAt: at("2026-10-26T09:00:00"), requestedDeliveryAt: at("2026-10-27T20:00:00"), deliveredAt: null, status: "FAILED" }, now)).toBe("vencida");
    expect(classifyBurned({ createdAt: at("2026-10-28T09:00:00"), requestedDeliveryAt: at("2026-10-28T20:00:00"), deliveredAt: null, status: "ASSIGNED" }, now)).toBeNull();
  });
  it("un 'casi medianoche' en hora CDMX no cambia de día por estar en UTC", () => {
    expect(classifyBurned({ createdAt: at("2026-10-26T23:30:00"), requestedDeliveryAt: at("2026-10-26T23:59:00"), deliveredAt: null, status: "CREATED" }, at("2026-10-26T23:50:00"))).toBeNull();
  });
});

describe("consultas de informes", () => {
  afterAll(() => prisma.$disconnect());
  it("corren sobre la base sin errores y devuelven forma correcta", async () => {
    const r = { from: new Date(Date.now() - 30 * 86400_000), to: new Date() };
    const [d, h, z] = await Promise.all([driverReport(prisma, r), deliveriesByHour(prisma, r), zoneReport(prisma, r)]);
    expect(Array.isArray(d)).toBe(true);
    expect(h).toHaveLength(24);
    for (const x of d) expect(x.effectiveness).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(z)).toBe(true);
  });
});
