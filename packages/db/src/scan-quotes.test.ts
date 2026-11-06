import { describe, expect, it } from "vitest";
import { normalizeScan, parseScan } from "./scan.ts";

describe("lecturas de lector tipo teclado", () => {
  it("acepta comillas tipográficas del iPad", () => {
    const raw = "{“id”:”48427190525”,”sender_id”:54733329,”hash_code”:null,”security_digit”:null}";
    expect(parseScan(raw)).toEqual({ kind: "ML", shipmentId: 48427190525n, senderId: 54733329n });
    expect(normalizeScan(raw)).toBe('{"id":"48427190525","sender_id":54733329,"hash_code":null,"security_digit":null}');
  });
  it("rescata el envío de una lectura cortada", () => {
    expect(parseScan('{"id":"48427190525","sender_id":5473')).toMatchObject({ kind: "ML", shipmentId: 48427190525n });
    expect(parseScan("{basura}")).toMatchObject({ kind: "INVALID" });
  });
});
