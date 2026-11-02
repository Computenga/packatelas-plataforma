import { describe, expect, it } from "vitest";
import { fetchMlSaleDetail, mapMlOrderItems, packageText, parseMlDimensions } from "./ml-sale.ts";

describe("detalle de venta ML [I14]", () => {
  it("lee medidas en texto y en objeto", () => {
    expect(parseMlDimensions("30.0x20.0x10.0,1500.0")).toEqual({ lengthCm: 30, widthCm: 20, heightCm: 10, weightG: 1500 });
    expect(parseMlDimensions({ length: 5, width: 4, height: 3, weight: 200 })).toEqual({ lengthCm: 5, widthCm: 4, heightCm: 3, weightG: 200 });
    expect(parseMlDimensions("sin medidas")).toBeNull();
    expect(packageText({ pkgWeightG: 1500, pkgLengthCm: 30, pkgWidthCm: 20, pkgHeightCm: 10 })).toBe("30 × 20 × 10 cm · 1.5 kg");
    expect(packageText({ pkgWeightG: 350, pkgLengthCm: null, pkgWidthCm: null, pkgHeightCm: null })).toBe("350 g");
  });

  it("arma los artículos con variación, SKU y precio", () => {
    const items = mapMlOrderItems([
      { order_items: [{ item: { id: "MLM1", title: "Playera", seller_sku: "PL-01", variation_attributes: [{ name: "Talla", value_name: "M" }] }, quantity: 2, unit_price: 199.5, currency_id: "MXN" }] },
    ]);
    expect(items).toEqual([{ itemId: "MLM1", title: "Playera", variation: "Talla: M", sku: "PL-01", quantity: 2, unitPrice: 199.5, currency: "MXN" }]);
  });

  it("junta las órdenes de un carrito y toma las medidas de los artículos del envío", async () => {
    const res = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const fake = (async (url: string) => {
      if (url.endsWith("/packs/9")) return res({ orders: [{ id: 1 }, { id: 2 }] });
      if (url.endsWith("/orders/1")) return res({ order_items: [{ item: { title: "A" }, quantity: 1, unit_price: 100 }] });
      if (url.endsWith("/orders/2")) return res({ order_items: [{ item: { title: "B" }, quantity: 3, unit_price: 50 }] });
      if (url.endsWith("/shipments/5")) return res({ id: 5 });
      if (url.endsWith("/shipments/5/items")) return res([{ dimensions: "10x10x10,800" }]);
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const d = await fetchMlSaleDetail("t", { shipmentId: 5n, mlOrderId: 1n, packId: 9n }, fake);
    expect(d.items.map((i) => i.title)).toEqual(["A", "B"]);
    expect(d.total).toBe(250);
    expect(d.weightG).toBe(800);
    expect(d.lengthCm).toBe(10);
  });
});
