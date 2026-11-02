import { describe, expect, it } from "vitest";
import { normalizeStoreUrl, storeLinks } from "./store-links.ts";

describe("enlaces de la tienda", () => {
  it("reconoce enlaces con y sin https", () => {
    expect(storeLinks("https://www.mercadolibre.com.mx/tienda/acme")[0]).toEqual({ href: "https://www.mercadolibre.com.mx/tienda/acme", label: "mercadolibre.com.mx/tienda/acme" });
    expect(normalizeStoreUrl("acme.mx y instagram.com/acme")).toBe("https://acme.mx/ https://instagram.com/acme");
    expect(normalizeStoreUrl("MercadoLibre, Tiendanube")).toBeNull();
    expect(normalizeStoreUrl("ventas@acme.com")).toBeNull();
    expect(normalizeStoreUrl("")).toBeNull();
  });
});
