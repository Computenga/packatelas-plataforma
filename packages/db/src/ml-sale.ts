// Detalle de la venta de MercadoLibre en el pedido [I14]: qué compró el comprador, cuántos, a qué precio,
// y el peso y medidas del paquete. Se trae una sola vez por pedido (la venta no cambia).
// Todo lo de red pasa por `fetchImpl` para poder probarlo sin internet.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

type Fetch = typeof fetch;
const API = "https://api.mercadolibre.com";

export type MlSaleItem = {
  itemId: string | null;
  title: string;
  variation: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number | null;
  currency: string | null;
};

export type MlSaleDetail = {
  items: MlSaleItem[];
  total: number | null;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
};

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "10.0x20.0x5.0,500.0" (cm × cm × cm, gramos) → medidas. Pura. */
export function parseMlDimensions(v: unknown) {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { lengthCm: num(o.length), widthCm: num(o.width), heightCm: num(o.height), weightG: num(o.weight) };
  }
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^([\d.]+)x([\d.]+)x([\d.]+)(?:,([\d.]+))?$/i);
  if (!m) return null;
  return { lengthCm: num(m[1]), widthCm: num(m[2]), heightCm: num(m[3]), weightG: num(m[4]) };
}

/** Artículos de una o varias órdenes de ML (respuesta de /orders/{id}). Pura. */
export function mapMlOrderItems(orders: Record<string, unknown>[]): MlSaleItem[] {
  const out: MlSaleItem[] = [];
  for (const o of orders) {
    const list = Array.isArray(o.order_items) ? (o.order_items as Record<string, unknown>[]) : [];
    for (const oi of list) {
      const item = (oi.item ?? {}) as Record<string, unknown>;
      const attrs = Array.isArray(item.variation_attributes) ? (item.variation_attributes as { name?: string; value_name?: string }[]) : [];
      const variation = attrs.map((a) => [a.name, a.value_name].filter(Boolean).join(": ")).filter(Boolean).join(" · ") || null;
      out.push({
        itemId: (item.id as string) ?? null,
        title: String(item.title ?? "Artículo").slice(0, 200),
        variation,
        sku: ((item.seller_sku ?? item.seller_custom_field) as string) || null,
        quantity: Number(oi.quantity) || 1,
        unitPrice: num(oi.unit_price) ?? (Number(oi.unit_price) === 0 ? 0 : null),
        currency: (oi.currency_id as string) || null,
      });
    }
  }
  return out;
}

async function getJson(url: string, token: string, fetchImpl: Fetch) {
  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  return (await r.json()) as unknown;
}

/** Trae de ML los artículos de la venta y el peso/medidas del paquete. Nunca lanza: lo que falte queda en null. */
export async function fetchMlSaleDetail(
  token: string,
  ids: { shipmentId: bigint; mlOrderId: bigint | null; packId: bigint | null },
  fetchImpl: Fetch = fetch,
): Promise<MlSaleDetail> {
  const detail: MlSaleDetail = { items: [], total: null, weightG: null, lengthCm: null, widthCm: null, heightCm: null };
  // Órdenes de la venta: en un carrito (pack) puede haber varias en el mismo envío.
  let orderIds: string[] = ids.mlOrderId ? [ids.mlOrderId.toString()] : [];
  if (ids.packId) {
    const p = (await getJson(`${API}/packs/${ids.packId}`, token, fetchImpl).catch(() => null)) as { orders?: { id?: number | string }[] } | null;
    const fromPack = (p?.orders ?? []).map((o) => String(o.id ?? "")).filter((x) => /^\d+$/.test(x));
    if (fromPack.length) orderIds = fromPack;
  }
  const orders: Record<string, unknown>[] = [];
  for (const id of orderIds.slice(0, 10)) {
    const o = (await getJson(`${API}/orders/${id}`, token, fetchImpl).catch(() => null)) as Record<string, unknown> | null;
    if (o) orders.push(o);
  }
  detail.items = mapMlOrderItems(orders);
  if (detail.items.length) {
    const priced = detail.items.filter((i) => i.unitPrice != null);
    detail.total = priced.length ? Math.round(priced.reduce((s, i) => s + i.unitPrice! * i.quantity, 0) * 100) / 100 : null;
  }

  // Peso y medidas: primero las del envío; si no vienen, las de los artículos del envío.
  const ship = (await getJson(`${API}/shipments/${ids.shipmentId}`, token, fetchImpl).catch(() => null)) as Record<string, unknown> | null;
  const shipDims = parseMlDimensions(ship?.dimensions) ?? parseMlDimensions((ship?.shipping_option as Record<string, unknown> | undefined)?.dimensions);
  let dims = shipDims;
  if (!dims || dims.weightG == null) {
    const items = (await getJson(`${API}/shipments/${ids.shipmentId}/items`, token, fetchImpl).catch(() => null)) as Record<string, unknown>[] | null;
    const first = Array.isArray(items) ? items.map((i) => parseMlDimensions(i.dimensions)).find(Boolean) : null;
    if (first) dims = { ...first, ...Object.fromEntries(Object.entries(dims ?? {}).filter(([, v]) => v != null)) } as typeof first;
    // Sin título desde la orden (sin permiso de órdenes): al menos lo que dice el envío.
    if (!detail.items.length && Array.isArray(items)) {
      detail.items = items.map((i) => ({
        itemId: (i.item_id as string) ?? null,
        title: String(i.description ?? "Artículo").slice(0, 200),
        variation: null, sku: null,
        quantity: Number(i.quantity) || 1,
        unitPrice: null, currency: null,
      }));
    }
  }
  if (dims) Object.assign(detail, dims);
  return detail;
}

/** Guarda el detalle en el pedido (una sola vez) y completa «Contenido» si estaba vacío. */
export async function saveMlSaleDetail(db: PrismaClient | Prisma.TransactionClient, orderId: string, d: MlSaleDetail) {
  // Se marca como consultado aunque ML no devuelva nada, para no volver a pedirlo en cada vuelta.
  if (!d.items.length && d.weightG == null && d.lengthCm == null) {
    await db.order.update({ where: { id: orderId }, data: { mlDetailAt: new Date() } });
    return false;
  }
  const summary = d.items.map((i) => `${i.quantity}× ${i.title}`).join(", ").slice(0, 300) || null;
  const cur = await db.order.findUnique({ where: { id: orderId }, select: { itemsSummary: true } });
  await db.order.update({
    where: { id: orderId },
    data: {
      mlItems: d.items as unknown as Prisma.InputJsonValue,
      mlSaleTotal: d.total,
      pkgWeightG: d.weightG != null ? Math.round(d.weightG) : null,
      pkgLengthCm: d.lengthCm,
      pkgWidthCm: d.widthCm,
      pkgHeightCm: d.heightCm,
      mlDetailAt: new Date(),
      ...(!cur?.itemsSummary && summary ? { itemsSummary: summary } : {}),
    },
  });
  return true;
}

/** Texto corto de medidas: "30 × 20 × 10 cm · 1.2 kg". Pura. */
export function packageText(o: { pkgWeightG: number | null; pkgLengthCm: number | null; pkgWidthCm: number | null; pkgHeightCm: number | null }) {
  const f = (n: number) => (Math.round(n * 10) / 10).toString();
  const size = o.pkgLengthCm && o.pkgWidthCm && o.pkgHeightCm ? `${f(o.pkgLengthCm)} × ${f(o.pkgWidthCm)} × ${f(o.pkgHeightCm)} cm` : null;
  const weight = o.pkgWeightG != null ? (o.pkgWeightG >= 1000 ? `${f(o.pkgWeightG / 1000)} kg` : `${o.pkgWeightG} g`) : null;
  return [size, weight].filter(Boolean).join(" · ") || null;
}
