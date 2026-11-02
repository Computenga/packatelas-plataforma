import { describe, expect, it } from "vitest";
import { earliestPickupDate, pickupDateFor, pickupDayLabel } from "./pickups.ts";

// Horas de la Ciudad de México (UTC-6)
const mx = (s: string) => new Date(`${s}-06:00`);

describe("horario de recolecciones", () => {
  it("antes de las 12 es hoy; después, el siguiente día hábil (sin domingo)", () => {
    expect(earliestPickupDate(mx("2026-11-02T11:59:00"))).toBe("2026-11-02"); // lunes antes de las 12
    expect(earliestPickupDate(mx("2026-11-02T12:00:00"))).toBe("2026-11-03"); // lunes 12:00 → martes
    expect(earliestPickupDate(mx("2026-11-07T15:00:00"))).toBe("2026-11-09"); // sábado tarde → lunes
    expect(earliestPickupDate(mx("2026-11-08T09:00:00"))).toBe("2026-11-09"); // domingo → lunes
  });
  it("ajusta la fecha pedida", () => {
    expect(pickupDateFor("2026-11-02", mx("2026-11-02T13:00:00"))).toEqual({ ymd: "2026-11-03", moved: true });
    expect(pickupDateFor("2026-11-05", mx("2026-11-02T13:00:00"))).toEqual({ ymd: "2026-11-05", moved: false });
    expect(pickupDateFor("2026-11-08", mx("2026-11-02T09:00:00"))).toEqual({ ymd: "2026-11-09", moved: true }); // pidió domingo
    expect(pickupDayLabel("2026-11-09")).toBe("lunes, 9 de noviembre");
  });
});
