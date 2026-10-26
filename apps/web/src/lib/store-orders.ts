// Pedidos de tiendas en línea → envíos [I06]. Funciones puras: validan la firma del webhook y
// traducen el pedido de WooCommerce o Shopify a los datos de un envío de Packatelas.
import { createHmac, timingSafeEqual } from "node:crypto";

export type StoreOrder = {
  ref: string; // referencia única por cliente (WC-123 / SH-456)
  recipientName: string;
  recipientPhone?: string;
  addressLine: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  instructions?: string;
  itemsSummary?: string;
};
export type MapResult = { order: StoreOrder } | { skip: string };

/** Firma base64(HMAC-SHA256(secreto, cuerpo)) — la usan WooCommerce y Shopify. */
export function validSignature(secret: string, rawBody: string, header: string | null) {
  if (!header) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"));
  const got = Buffer.from(header.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** CP de CDMX (01000–16999) o del Estado de México (50000–57999). */
export function zipInZone(zip?: string | null) {
  const z = Number((zip ?? "").replace(/\D/g, "").slice(0, 5));
  return (z >= 1000 && z <= 16999) || (z >= 50000 && z <= 57999);
}

const clean = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const join = (...p: (string | null | undefined)[]) => p.map(clean).filter(Boolean).join(" ");
const items = (list: { name?: string; title?: string; quantity?: number }[] = []) =>
  list.map((i) => `${i.quantity ?? 1} × ${clean(i.name ?? i.title)}`).join(", ").slice(0, 200) || undefined;
const phone = (s?: string | null) => {
  const d = clean(s).replace(/[^\d+]/g, "");
  return d.length >= 8 ? d.slice(0, 18) : undefined;
};

type WooAddress = { first_name?: string; last_name?: string; company?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string; phone?: string };
export type WooOrder = {
  id?: number; number?: string; status?: string; shipping?: WooAddress; billing?: WooAddress; customer_note?: string;
  line_items?: { name?: string; quantity?: number }[]; shipping_lines?: { method_id?: string; method_title?: string }[];
};

const WOO_PAID = ["processing", "completed"];

export function mapWoo(o: WooOrder): MapResult {
  if (!o?.id) return { skip: "Pedido sin id" };
  if (!WOO_PAID.includes(o.status ?? "")) return { skip: `Estado ${o.status ?? "desconocido"}: se crea al pasar a "Procesando"` };
  if (o.shipping_lines?.some((s) => s.method_id === "local_pickup")) return { skip: "Recoge en tienda" };
  const s = o.shipping?.address_1 ? o.shipping : o.billing;
  if (!s?.address_1) return { skip: "Sin dirección de envío" };
  if (s.country && s.country !== "MX") return { skip: `Fuera de México (${s.country})` };
  if (!zipInZone(s.postcode)) return { skip: `CP ${s.postcode || "sin CP"} fuera de CDMX y Edomex` };
  return {
    order: {
      ref: `WC-${o.number ?? o.id}`,
      recipientName: join(s.first_name, s.last_name) || clean(s.company) || "Sin nombre",
      recipientPhone: phone(s.phone) ?? phone(o.billing?.phone),
      addressLine: clean(s.address_1).slice(0, 200),
      neighborhood: clean(s.address_2) || undefined,
      city: clean(s.city) || undefined,
      state: clean(s.state) || undefined,
      zip: clean(s.postcode).slice(0, 5) || undefined,
      instructions: clean(o.customer_note).slice(0, 500) || undefined,
      itemsSummary: items(o.line_items),
    },
  };
}

type ShopifyAddress = { first_name?: string; last_name?: string; name?: string; company?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string; country_code?: string; phone?: string; latitude?: number | null; longitude?: number | null };
export type ShopifyOrder = {
  id?: number; name?: string; financial_status?: string; cancelled_at?: string | null; shipping_address?: ShopifyAddress | null;
  phone?: string | null; note?: string | null; line_items?: { title?: string; quantity?: number }[];
};

export function mapShopify(o: ShopifyOrder): MapResult {
  if (!o?.id) return { skip: "Pedido sin id" };
  if (o.cancelled_at) return { skip: "Pedido cancelado" };
  if (!["paid", "partially_paid", "authorized"].includes(o.financial_status ?? "")) return { skip: `Pago ${o.financial_status ?? "pendiente"}: se crea al pagarse` };
  const s = o.shipping_address;
  if (!s?.address1) return { skip: "Sin dirección de envío (recoge en tienda o producto digital)" };
  if (s.country_code && s.country_code !== "MX") return { skip: `Fuera de México (${s.country_code})` };
  if (!zipInZone(s.zip)) return { skip: `CP ${s.zip || "sin CP"} fuera de CDMX y Edomex` };
  const lat = typeof s.latitude === "number" ? s.latitude : undefined, lng = typeof s.longitude === "number" ? s.longitude : undefined;
  const okCoords = lat != null && lng != null && lat >= 18.85 && lat <= 20.05 && lng >= -99.75 && lng <= -98.55;
  return {
    order: {
      ref: `SH-${(o.name ?? String(o.id)).replace(/^#/, "")}`,
      recipientName: clean(s.name) || join(s.first_name, s.last_name) || clean(s.company) || "Sin nombre",
      recipientPhone: phone(s.phone) ?? phone(o.phone),
      addressLine: clean(s.address1).slice(0, 200),
      neighborhood: clean(s.address2) || undefined,
      city: clean(s.city) || undefined,
      state: clean(s.province) || undefined,
      zip: clean(s.zip).slice(0, 5) || undefined,
      ...(okCoords ? { lat, lng } : {}),
      instructions: clean(o.note).slice(0, 500) || undefined,
      itemsSummary: items(o.line_items),
    },
  };
}
