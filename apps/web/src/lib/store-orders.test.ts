import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapShopify, mapWoo, validSignature, zipInZone } from "./store-orders";

const woo = {
  id: 77, number: "1077", status: "processing",
  shipping: { first_name: "Ana", last_name: "Pérez", address_1: "Calle Ficticia 12", address_2: "Col. Centro", city: "Cuauhtémoc", state: "DF", postcode: "06000", country: "MX", phone: "" },
  billing: { phone: "55 1234 5678" },
  customer_note: "Dejar con el portero",
  line_items: [{ name: "Cable USB", quantity: 2 }],
  shipping_lines: [{ method_id: "flat_rate" }],
};

describe("tiendas en línea", () => {
  it("firma base64 HMAC-SHA256 igual que WooCommerce y Shopify", () => {
    const body = JSON.stringify(woo);
    const sig = createHmac("sha256", "s3cr3t").update(body).digest("base64");
    expect(validSignature("s3cr3t", body, sig)).toBe(true);
    expect(validSignature("otro", body, sig)).toBe(false);
    expect(validSignature("s3cr3t", body, null)).toBe(false);
  });

  it("zona: CDMX y Edomex por código postal", () => {
    expect(zipInZone("06000")).toBe(true);
    expect(zipInZone("54050")).toBe(true);
    expect(zipInZone("44100")).toBe(false);
    expect(zipInZone("")).toBe(false);
  });

  it("WooCommerce: pedido pagado se traduce a envío", () => {
    const r = mapWoo(woo);
    expect(r).toEqual({ order: expect.objectContaining({ ref: "WC-1077", recipientName: "Ana Pérez", recipientPhone: "5512345678", addressLine: "Calle Ficticia 12", zip: "06000", itemsSummary: "2 × Cable USB", instructions: "Dejar con el portero" }) });
  });

  it("WooCommerce: ignora pendientes, recoger en tienda y fuera de zona", () => {
    expect(mapWoo({ ...woo, status: "pending" })).toMatchObject({ skip: expect.stringContaining("Procesando") });
    expect(mapWoo({ ...woo, shipping_lines: [{ method_id: "local_pickup" }] })).toEqual({ skip: "Recoge en tienda" });
    expect(mapWoo({ ...woo, shipping: { ...woo.shipping, postcode: "44100" } })).toMatchObject({ skip: expect.stringContaining("fuera") });
  });

  it("Shopify: pagado con coordenadas; no pagado se ignora", () => {
    const sh = {
      id: 9, name: "#1009", financial_status: "paid", cancelled_at: null, note: null,
      shipping_address: { name: "Luis Ruiz", address1: "Av. Ficticia 99", address2: "Del Valle", city: "Benito Juárez", province: "Ciudad de México", zip: "03100", country_code: "MX", phone: "+52 55 0000 0000", latitude: 19.38, longitude: -99.17 },
      line_items: [{ title: "Funda", quantity: 1 }],
    };
    expect(mapShopify(sh)).toEqual({ order: expect.objectContaining({ ref: "SH-1009", recipientName: "Luis Ruiz", lat: 19.38, lng: -99.17, zip: "03100" }) });
    expect(mapShopify({ ...sh, financial_status: "pending" })).toMatchObject({ skip: expect.stringContaining("pend") });
    expect(mapShopify({ ...sh, shipping_address: null })).toMatchObject({ skip: expect.stringContaining("Sin dirección") });
  });
});
