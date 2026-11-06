// Tienda de insumos en el portal de la tienda [P17].
// - Catálogo: se copia solo de la tienda WooCommerce de packatelas.com.mx (API pública de la tienda),
//   que sigue siendo donde se dan de alta productos, precios y fotos. Aquí solo se puede ocultar alguno.
// - Pago: con el saldo a favor (si alcanza) o con tarjeta (Mercado Pago, sin comisión extra).
// - Entrega: el repartidor lleva los insumos en la siguiente recolección de esa sucursal; si no hay
//   una agendada, se crea para el primer día posible. Al recolectar, el pedido queda entregado.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { mp, mpConfigured } from "./mercadopago.ts";
import { audit } from "./orders.ts";
import { dateOnly, earliestPickupDate, requestPickup } from "./pickups.ts";
import { adminUserIds, sendPush } from "./push.ts";

type Fetch = typeof fetch;
export const WOO_STORE_URL = process.env.WOO_STORE_URL?.trim() || "https://packatelas.com.mx";
const HIDE = /prepago/i;

export type StoreItem = { productId: string; sku: string | null; name: string; price: number; qty: number };

const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8243;/g, "″").replace(/<[^>]+>/g, "").trim();

/** Copia el catálogo de WooCommerce (productos simples). Lo que ya no aparece queda agotado. */
export async function syncStoreCatalog(prisma: PrismaClient, fetchImpl: Fetch = fetch) {
  const seen: number[] = [];
  let upserts = 0;
  for (let page = 1; page <= 10; page++) {
    const r = await fetchImpl(`${WOO_STORE_URL}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`La tienda WooCommerce respondió ${r.status}`);
    const list = (await r.json()) as {
      id: number; name: string; type: string; sku: string; short_description?: string; description?: string; is_in_stock?: boolean; is_purchasable?: boolean;
      prices: { price: string; currency_minor_unit: number }; images?: { src: string; thumbnail?: string }[]; categories?: { name: string }[]; permalink?: string;
    }[];
    for (const p of list) {
      if (p.type !== "simple" || HIDE.test(p.name)) continue;
      const price = Number(p.prices.price) / 10 ** (p.prices.currency_minor_unit ?? 2);
      if (!(price > 0)) continue;
      seen.push(p.id);
      const data = {
        name: decode(p.name).slice(0, 200),
        sku: p.sku || null,
        category: decode(p.categories?.[0]?.name ?? "Otros").slice(0, 80),
        price: new Prisma.Decimal(price.toFixed(2)),
        imageUrl: p.images?.[0]?.thumbnail || p.images?.[0]?.src || null,
        description: decode(p.short_description || p.description || "").slice(0, 400) || null,
        inStock: p.is_in_stock !== false && p.is_purchasable !== false,
        url: p.permalink ?? null,
      };
      await prisma.storeProduct.upsert({ where: { wooId: p.id }, create: { wooId: p.id, ...data }, update: data });
      upserts++;
    }
    if (list.length < 100) break;
  }
  if (seen.length) await prisma.storeProduct.updateMany({ where: { wooId: { notIn: seen } }, data: { inStock: false } });
  return { products: upserts };
}

const money = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

/** Precio que ve y paga la tienda: el del portal si el admin lo puso, si no el de WooCommerce. */
export function storePrice(p: { price: { toString(): string }; portalPrice?: { toString(): string } | null }) {
  return Number((p.portalPrice ?? p.price).toString());
}

/** Valida el carrito contra el catálogo vigente (precios del servidor, nunca del navegador). */
async function priceCart(prisma: PrismaClient, cart: { productId: string; qty: number }[]) {
  const lines = cart.filter((c) => Number.isInteger(c.qty) && c.qty > 0 && c.qty <= 500).slice(0, 50);
  if (!lines.length) throw new Error("Tu carrito está vacío");
  const products = await prisma.storeProduct.findMany({ where: { id: { in: lines.map((l) => l.productId) }, active: true, inStock: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items: StoreItem[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p) throw new Error("Un producto del carrito ya no está disponible; quítalo e intenta de nuevo");
    items.push({ productId: p.id, sku: p.sku, name: p.name, price: storePrice(p), qty: l.qty });
  }
  const total = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  return { items, total };
}

/**
 * Crea el pedido. Con saldo: se paga y agenda al momento. Con tarjeta: devuelve la liga de Mercado Pago;
 * al aprobarse el pago, `fulfillStoreOrder` lo paga y agenda.
 */
export async function placeStoreOrder(
  prisma: PrismaClient,
  input: { clientId: string; userId: string; branchId: string; cart: { productId: string; qty: number }[]; pay: "saldo" | "tarjeta"; baseUrl: string },
  fetchImpl: Fetch = fetch,
) {
  const branch = await prisma.branch.findFirst({ where: { id: input.branchId, clientId: input.clientId, active: true } });
  if (!branch) throw new Error("Elige a qué dirección te lo llevamos");
  const { items, total } = await priceCart(prisma, input.cart);

  if (input.pay === "saldo") {
    const bal = Number((await prisma.ledgerEntry.aggregate({ where: { clientId: input.clientId }, _sum: { amount: true } }))._sum.amount ?? 0);
    const favor = -bal;
    if (favor + 0.005 < total) throw new Error(`Tu saldo a favor (${money(Math.max(0, favor))}) no alcanza para ${money(total)}. Paga con tarjeta.`);
    const o = await prisma.storeOrder.create({ data: { clientId: input.clientId, branchId: branch.id, items: items as unknown as Prisma.InputJsonValue, total, payMethod: "SALDO", createdById: input.userId } });
    await fulfillStoreOrder(prisma, o.id);
    return { id: o.id, url: null as string | null };
  }

  if (!mpConfigured()) throw new Error("El pago con tarjeta no está disponible por ahora");
  const checkout = await prisma.mpCheckout.create({ data: { clientId: input.clientId, amount: total, fee: 0, total, createdById: input.userId } });
  const o = await prisma.storeOrder.create({
    data: { clientId: input.clientId, branchId: branch.id, items: items as unknown as Prisma.InputJsonValue, total, payMethod: "TARJETA", checkoutId: checkout.id, createdById: input.userId },
  });
  const base = input.baseUrl.replace(/\/$/, "");
  const pref = await mp<{ id: string; init_point: string }>(
    "/checkout/preferences",
    {
      method: "POST",
      headers: { "X-Idempotency-Key": checkout.id },
      body: JSON.stringify({
        items: items.map((i) => ({ id: i.sku ?? i.productId, title: i.name.slice(0, 120), quantity: i.qty, unit_price: i.price, currency_id: "MXN" })),
        external_reference: checkout.id,
        statement_descriptor: "PACKATELAS",
        notification_url: `${base}/api/mp/webhook`,
        back_urls: { success: `${base}/cliente/tienda?pedido=${o.id}`, pending: `${base}/cliente/tienda?pedido=${o.id}`, failure: `${base}/cliente/tienda?pago=error` },
        auto_return: "approved",
        expires: true,
        expiration_date_to: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }),
    },
    fetchImpl,
  );
  await prisma.mpCheckout.update({ where: { id: checkout.id }, data: { preferenceId: pref.id } });
  return { id: o.id, url: pref.init_point };
}

/** Busca (o crea) la recolección donde el repartidor llevará los insumos. */
async function attachToPickup(prisma: PrismaClient, orderId: string) {
  const o = await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } });
  const from = earliestPickupDate();
  let pickup = await prisma.pickup.findFirst({
    where: { clientId: o.clientId, branchId: o.branchId, scheduledFor: { gte: dateOnly(from) }, status: { in: ["SCHEDULED", "ASSIGNED", "BLOCKED"] } },
    orderBy: { scheduledFor: "asc" },
  });
  if (!pickup) pickup = await requestPickup(prisma, { clientId: o.clientId, branchId: o.branchId, ymd: from, note: "Entrega de insumos de la tienda" });
  await prisma.storeOrder.update({ where: { id: o.id }, data: { pickupId: pickup.id } });
  return pickup;
}

/** Pago confirmado: movimiento en su estado de cuenta, se agenda la entrega y se avisa al equipo. Idempotente. */
export async function fulfillStoreOrder(prisma: PrismaClient, orderId: string) {
  const claimed = await prisma.storeOrder.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "PAID", paidAt: new Date() } });
  if (!claimed.count) return null;
  const o = await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId }, include: { client: { select: { name: true } } } });
  await prisma.ledgerEntry.create({
    data: { clientId: o.clientId, type: "PURCHASE", amount: o.total, description: `Compra en la tienda ${storeFolio(o.number)} (${o.payMethod === "SALDO" ? "con saldo a favor" : "pagada con tarjeta"})`, createdById: o.createdById },
  });
  const pickup = await attachToPickup(prisma, o.id).catch((e) => { console.error("[tienda] agendar", e); return null; });
  await audit(prisma, { actorUserId: o.createdById, action: "store.paid", entity: "StoreOrder", entityId: o.id, summary: `Pedido de tienda ${storeFolio(o.number)} de ${o.client.name} por ${money(Number(o.total))}` });
  const items = (o.items as unknown as StoreItem[]).map((i) => `${i.qty}× ${i.name}`).join(", ");
  await sendPush(prisma, await adminUserIds(prisma), {
    title: `Tienda: preparar ${storeFolio(o.number)} · ${o.client.name}`,
    body: `${items.slice(0, 140)}${pickup ? ` · va con la recolección del ${pickup.scheduledFor.toISOString().slice(0, 10)}` : ""}`,
    url: "/admin/tienda",
  }).catch(() => {});
  return o;
}

/** Hook de recolecciones: recolectada → insumos entregados; fallida → pasan a la siguiente recolección. */
export async function storeOrdersAfterPickup(prisma: PrismaClient, pickupId: string, collected: boolean) {
  const orders = await prisma.storeOrder.findMany({ where: { pickupId, status: { in: ["PAID", "READY"] } }, select: { id: true } });
  for (const o of orders) {
    if (collected) await prisma.storeOrder.update({ where: { id: o.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    else {
      await prisma.storeOrder.update({ where: { id: o.id }, data: { pickupId: null } });
      await attachToPickup(prisma, o.id).catch(() => null);
    }
  }
  return orders.length;
}

export const storeFolio = (n: number) => `T-${String(n).padStart(5, "0")}`;
export const STORE_STATUS: Record<string, [string, "gray" | "blue" | "amber" | "green" | "red"]> = {
  PENDING_PAYMENT: ["Esperando pago", "gray"],
  PAID: ["Pagado · por preparar", "blue"],
  READY: ["Listo para entregar", "amber"],
  DELIVERED: ["Entregado", "green"],
  CANCELLED: ["Cancelado", "red"],
};
