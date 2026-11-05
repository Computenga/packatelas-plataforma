import { describe, expect, it } from "vitest";
import { parseVehicleQr, vehicleQrText } from "./vehicle-qr";

describe("QR del llavero de moto", () => {
  it("lee los llaveros viejos y los nuevos", () => {
    expect(parseVehicleQr(vehicleQrText("M-01"))).toBe("M-01");
    expect(parseVehicleQr("FLOTILLA:M-AB1234")).toBe("M-AB1234");
    expect(parseVehicleQr(" m-07 ")).toBe("M-07");
    expect(parseVehicleQr("m07")).toBe("M-07");
  });
  it("rechaza etiquetas que no son de moto", () => {
    expect(parseVehicleQr("PK-000123")).toBeNull();
    expect(parseVehicleQr("48323149259")).toBeNull();
    expect(parseVehicleQr("")).toBeNull();
  });
});
