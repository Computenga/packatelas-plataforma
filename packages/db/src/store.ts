// Tienda de insumos en el portal de la tienda [P17].
// - Catálogo: se da de alta en el portal (título, fotos, precio normal y de oferta, SKU, stock y
//   descripción). Ya no se copia de WooCommerce.
// - Pago: con el saldo a favor (si alcanza) o en el momento con tarjeta (Mercado Pago, sin comisión extra).
// - Entrega: cada compra pagada genera un pedido de entrega con folio IN-00001 a la sucursal de la
//   tienda; despacho lo asigna a un repartidor como cualquier pedido (sin costo de envío). Al
//   entregarlo, la compra queda entregada.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { mp, mpConfigured } from "./mercadopago.ts";
import { addOrderEvent, audit } from "./orders.ts";
import { dateOnly, earliestPickupDate, requestPickup } from "./pickups.ts";
import { adminUserIds, sendPush } from "./push.ts";

type Fetch = typeof fetch;

export type StoreItem = { productId: string; sku: string | null; name: string; price: number; qty: number };

const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8243;/g, "″").replace(/<[^>]+>/g, "").trim();

const money = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

type Num = { toString(): string };
/** Precio que se cobra: el de oferta si existe y es menor al normal; si no, el normal. */
export function storePrice(p: { price: Num; salePrice?: Num | null }) {
  const normal = Number(p.price.toString());
  const sale = p.salePrice != null ? Number(p.salePrice.toString()) : NaN;
  return sale > 0 && sale < normal ? sale : normal;
}
/** ¿Tiene precio de oferta vigente? (para tachar el precio normal) */
export const onSale = (p: { price: Num; salePrice?: Num | null }) => storePrice(p) < Number(p.price.toString());

/** Valida el carrito contra el catálogo vigente (precios del servidor, nunca del navegador). */
async function priceCart(prisma: PrismaClient, cart: { productId: string; qty: number }[]) {
  const lines = cart.filter((c) => Number.isInteger(c.qty) && c.qty > 0 && c.qty <= 500).slice(0, 50);
  if (!lines.length) throw new Error("Tu carrito está vacío");
  const products = await prisma.storeProduct.findMany({ where: { id: { in: lines.map((l) => l.productId) }, active: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items: StoreItem[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p) throw new Error("Un producto del carrito ya no está disponible; quítalo e intenta de nuevo");
    if (p.stock < l.qty) throw new Error(p.stock > 0 ? `De «${p.name}» solo quedan ${p.stock}` : `«${p.name}» se agotó; quítalo del carrito`);
    items.push({ productId: p.id, sku: p.sku, name: p.name, price: storePrice(p), qty: l.qty });
  }
  const total = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  return { items, total };
}

/**
 * Crea la compra. Con saldo: se paga y genera su pedido de entrega al momento. Con tarjeta: devuelve
 * la liga de Mercado Pago; al aprobarse el pago, `fulfillStoreOrder` hace lo mismo.
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

export const storeFolio = (n: number) => `IN-${String(n).padStart(5, "0")}`;

/** Pedido de entrega IN-00001 a la sucursal de la tienda: despacho lo asigna como cualquier pedido. */
async function createStoreDelivery(prisma: PrismaClient, storeOrderId: string) {
  const so = await prisma.storeOrder.findUniqueOrThrow({ where: { id: storeOrderId }, include: { client: { select: { name: true, contactName: true, phone: true } } } });
  if (so.orderId) return so.orderId;
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: so.branchId } });
  const items = so.items as unknown as StoreItem[];
  const code = storeFolio(so.number);
  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        code, source: "TIENDA", kind: "DELIVERY", status: "CREATED", clientId: so.clientId, branchId: branch.id,
        recipientName: so.client.contactName || so.client.name, recipientPhone: branch.phone || so.client.phone,
        addressLine: branch.address, lat: branch.lat, lng: branch.lng,
        itemsSummary: `Insumos: ${items.map((i) => `${i.qty}× ${i.name}`).join(", ")}`.slice(0, 2000),
        instructions: "Entrega de insumos comprados en la tienda del portal (ya pagados). Pedir nombre de quien recibe y foto.",
      },
    });
    await addOrderEvent(tx, { orderId: o.id, type: "created", source: "SYSTEM", note: `Compra en la tienda del portal (${so.payMethod === "SALDO" ? "pagada con saldo" : "pagada con tarjeta"})` });
    await tx.storeOrder.update({ where: { id: so.id }, data: { orderId: o.id } });
    return o;
  });
  return order.id;
}

/** Descuenta existencias; si alguna se queda en cero, el producto se marca agotado. */
async function takeStock(prisma: PrismaClient, items: StoreItem[]) {
  for (const i of items) {
    const p = await prisma.storeProduct.update({ where: { id: i.productId }, data: { stock: { decrement: i.qty } } }).catch(() => null);
    if (p && p.stock <= 0) await prisma.storeProduct.update({ where: { id: p.id }, data: { stock: 0, inStock: false } });
  }
}

/** Pago confirmado: movimiento en su estado de cuenta, se descuenta el stock, se crea el pedido IN- y se avisa. Idempotente. */
export async function fulfillStoreOrder(prisma: PrismaClient, orderId: string) {
  const claimed = await prisma.storeOrder.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "PAID", paidAt: new Date() } });
  if (!claimed.count) return null;
  const o = await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId }, include: { client: { select: { name: true } } } });
  await prisma.ledgerEntry.create({
    data: { clientId: o.clientId, type: "PURCHASE", amount: o.total, description: `Compra en la tienda ${storeFolio(o.number)} (${o.payMethod === "SALDO" ? "con saldo a favor" : "pagada con tarjeta"})`, createdById: o.createdById },
  });
  const items = o.items as unknown as StoreItem[];
  await takeStock(prisma, items).catch((e) => console.error("[tienda] stock", e));
  const deliveryId = await createStoreDelivery(prisma, o.id).catch((e) => { console.error("[tienda] pedido de entrega", e); return null; });
  await audit(prisma, { actorUserId: o.createdById, action: "store.paid", entity: "StoreOrder", entityId: o.id, summary: `Pedido de tienda ${storeFolio(o.number)} de ${o.client.name} por ${money(Number(o.total))}` });
  await sendPush(prisma, await adminUserIds(prisma), {
    title: `Tienda: ${storeFolio(o.number)} · ${o.client.name}`,
    body: `${items.map((i) => `${i.qty}× ${i.name}`).join(", ").slice(0, 140)} · prepáralo y asígnalo a un repartidor`,
    url: deliveryId ? `/admin/pedidos/${deliveryId}` : "/admin/tienda",
  }).catch(() => {});
  return o;
}

/** El repartidor entregó el pedido IN-: la compra queda entregada. */
export async function storeDeliveryDone(db: Prisma.TransactionClient | PrismaClient, orderId: string) {
  await db.storeOrder.updateMany({ where: { orderId, status: { in: ["PAID", "READY"] } }, data: { status: "DELIVERED", deliveredAt: new Date() } });
}

/** Busca (o crea) la recolección donde el repartidor llevará los insumos (solo pedidos anteriores al cambio). */
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

/** Pedidos anteriores (iban con la recolección): recolectada → entregados; fallida → a la siguiente. */
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

export const STORE_STATUS: Record<string, [string, "gray" | "blue" | "amber" | "green" | "red"]> = {
  PENDING_PAYMENT: ["Esperando pago", "gray"],
  PAID: ["Pagado · por entregar", "blue"],
  READY: ["Preparado · por entregar", "amber"],
  DELIVERED: ["Entregado", "green"],
  CANCELLED: ["Cancelado", "red"],
};

// ── Catálogo (alta y edición en el portal) ──
export type StoreProductInput = {
  name: string; category?: string | null; price: number; salePrice?: number | null; sku?: string | null; stock: number;
  description?: string | null; images: string[]; active: boolean;
};

export async function saveStoreProduct(prisma: PrismaClient, id: string | null, input: StoreProductInput, actorUserId?: string) {
  const name = input.name.trim().slice(0, 200);
  if (name.length < 3) throw new Error("Escribe el título del producto");
  if (!(input.price > 0 && input.price < 1_000_000)) throw new Error("El precio normal debe ser mayor a 0");
  const sale = input.salePrice != null && input.salePrice > 0 ? input.salePrice : null;
  if (sale != null && sale >= input.price) throw new Error("El precio de oferta debe ser menor al precio normal");
  if (!Number.isInteger(input.stock) || input.stock < 0 || input.stock > 1_000_000) throw new Error("El stock debe ser un número entero de 0 en adelante");
  const sku = input.sku?.trim().slice(0, 60) || null;
  if (sku) {
    const dup = await prisma.storeProduct.findFirst({ where: { sku, ...(id ? { id: { not: id } } : {}) }, select: { name: true } });
    if (dup) throw new Error(`Ese SKU ya lo tiene «${dup.name}»`);
  }
  const data = {
    name, category: input.category?.trim().slice(0, 80) || "Insumos", price: new Prisma.Decimal(input.price.toFixed(2)),
    salePrice: sale != null ? new Prisma.Decimal(sale.toFixed(2)) : null, sku, stock: input.stock, inStock: input.stock > 0,
    description: input.description?.trim().slice(0, 2000) || null, images: input.images.slice(0, 10), active: input.active,
  };
  const p = id ? await prisma.storeProduct.update({ where: { id }, data }) : await prisma.storeProduct.create({ data });
  await audit(prisma, { actorUserId, action: id ? "store.product_updated" : "store.product_created", entity: "StoreProduct", entityId: p.id, summary: `${p.name}: ${money(Number(p.price))}${sale ? ` (oferta ${money(sale)})` : ""}, stock ${p.stock}` });
  return p;
}

/** Foto de portada: la primera subida al portal o, si es un producto heredado, la de WooCommerce. */
export const storeCover = (p: { images: string[]; imageUrl: string | null }) => (p.images[0] ? `/api/tienda/foto/${p.images[0]}` : p.imageUrl);
