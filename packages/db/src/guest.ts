// Envío esporádico sin registro [P14]: cualquier persona contrata un envío suelto sin crear cuenta.
// Paga por adelantado con tarjeta (Mercado Pago, sin comisión extra) y al aprobarse el pago se crea
// la recolección en su domicilio y el envío a su destinatario, bajo la cuenta interna «Envíos sin registro».
// Precio: la tarifa de esa cuenta (por omisión $250), editable en Clientes como cualquier tarifa.
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { mp, mpConfigured } from "./mercadopago.ts";
import { addOrderEvent, audit, createManualOrder } from "./orders.ts";
import { pickupDateFor, requestPickup } from "./pickups.ts";
import { adminUserIds, sendPush } from "./push.ts";

type Fetch = typeof fetch;
export const GUEST_PUBLIC_ID = "cmx00000-sinregistro";
export const GUEST_DEFAULT_PRICE = 250;

/** Cuenta interna que agrupa los envíos sin registro (se crea la primera vez). */
export async function guestClient(prisma: PrismaClient) {
  const found = await prisma.client.findUnique({ where: { publicId: GUEST_PUBLIC_ID } });
  if (found) return found;
  return prisma.client.upsert({
    where: { publicId: GUEST_PUBLIC_ID },
    update: {},
    create: { publicId: GUEST_PUBLIC_ID, name: "Envíos sin registro", paymentReference: "SINREGISTRO", tariffAmount: GUEST_DEFAULT_PRICE },
  });
}

export async function guestPrice(prisma: PrismaClient) {
  return Number((await guestClient(prisma)).tariffAmount) || GUEST_DEFAULT_PRICE;
}

export type GuestInput = {
  senderName: string;
  senderPhone: string;
  senderEmail: string;
  pickupAddress: string;
  pickupReference?: string | null;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  neighborhood?: string | null;
  city: string;
  zip: string;
  instructions?: string | null;
  contents: string;
  pickupDate: string; // YYYY-MM-DD solicitado
  ip?: string | null;
};

const phone10 = (s: string) => s.replace(/\D/g, "").slice(-10);

/** Registra la solicitud y abre el pago. Devuelve la liga de Mercado Pago. */
export async function startGuestShipment(prisma: PrismaClient, input: GuestInput, baseUrl: string, fetchImpl: Fetch = fetch) {
  if (!mpConfigured()) throw new Error("El pago en línea no está disponible por ahora. Escríbenos por WhatsApp.");
  if (phone10(input.senderPhone).length !== 10 || phone10(input.recipientPhone).length !== 10) throw new Error("Los teléfonos deben tener 10 dígitos");
  // Freno simple contra abuso: máximo 5 solicitudes por IP por hora.
  if (input.ip) {
    const recent = await prisma.guestShipment.count({ where: { ip: input.ip, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= 5) throw new Error("Demasiadas solicitudes seguidas. Intenta en un rato.");
  }
  const client = await guestClient(prisma);
  const price = Number(client.tariffAmount) || GUEST_DEFAULT_PRICE;
  const { ymd } = pickupDateFor(input.pickupDate);
  const token = randomBytes(18).toString("base64url");
  const checkout = await prisma.mpCheckout.create({ data: { clientId: client.id, amount: price, fee: 0, total: price } });
  const g = await prisma.guestShipment.create({
    data: {
      token,
      checkoutId: checkout.id,
      price,
      senderName: input.senderName,
      senderPhone: phone10(input.senderPhone),
      senderEmail: input.senderEmail.toLowerCase(),
      pickupAddress: input.pickupAddress,
      pickupReference: input.pickupReference || null,
      pickupDate: new Date(`${ymd}T00:00:00Z`),
      recipientName: input.recipientName,
      recipientPhone: phone10(input.recipientPhone),
      addressLine: input.addressLine,
      neighborhood: input.neighborhood || null,
      city: input.city,
      zip: input.zip,
      instructions: input.instructions || null,
      contents: input.contents,
      ip: input.ip ?? null,
    },
  });
  const base = baseUrl.replace(/\/$/, "");
  const pref = await mp<{ id: string; init_point: string }>(
    "/checkout/preferences",
    {
      method: "POST",
      headers: { "X-Idempotency-Key": checkout.id },
      body: JSON.stringify({
        items: [{ id: "envio-sin-registro", title: "Envío Packatelas (recolección y entrega)", quantity: 1, unit_price: price, currency_id: "MXN" }],
        external_reference: checkout.id,
        statement_descriptor: "PACKATELAS",
        notification_url: `${base}/api/mp/webhook`,
        back_urls: { success: `${base}/enviar/${token}`, pending: `${base}/enviar/${token}`, failure: `${base}/enviar/${token}?pago=error` },
        auto_return: "approved",
        expires: true,
        expiration_date_to: new Date(Date.now() + 24 * 3600_000).toISOString(),
        payer: { email: input.senderEmail, name: input.senderName },
      }),
    },
    fetchImpl,
  );
  await prisma.mpCheckout.update({ where: { id: checkout.id }, data: { preferenceId: pref.id } });
  return { id: g.id, token, url: pref.init_point, price };
}

/**
 * Pago aprobado → crea la recolección (domicilio del remitente) y el envío al destinatario.
 * Idempotente: si ya se creó, no hace nada. Lo llama el aviso de Mercado Pago.
 */
export async function fulfillGuestShipment(prisma: PrismaClient, checkoutId: string) {
  const g = await prisma.guestShipment.findUnique({ where: { checkoutId } });
  if (!g || g.orderId) return null;
  const claimed = await prisma.guestShipment.updateMany({ where: { id: g.id, status: "PENDING_PAYMENT" }, data: { status: "PAID", paidAt: new Date() } });
  if (!claimed.count) return null;
  const client = await guestClient(prisma);
  const branch = await prisma.branch.create({
    data: { clientId: client.id, name: `${g.senderName} · ${g.senderPhone}`.slice(0, 120), address: [g.pickupAddress, g.pickupReference].filter(Boolean).join(" · "), phone: g.senderPhone },
  });
  const { ymd } = pickupDateFor(g.pickupDate.toISOString().slice(0, 10));
  const pickup = await requestPickup(prisma, { clientId: client.id, branchId: branch.id, ymd, expectedCount: 1, note: `Envío sin registro ${g.token.slice(0, 6)}: ${g.contents}`.slice(0, 200) });
  const order = await createManualOrder(prisma, {
    clientId: client.id,
    branchId: branch.id,
    recipientName: g.recipientName,
    recipientPhone: g.recipientPhone,
    addressLine: g.addressLine,
    neighborhood: g.neighborhood ?? undefined,
    city: g.city,
    zip: g.zip,
    instructions: [g.instructions, `Remitente: ${g.senderName} ${g.senderPhone}`].filter(Boolean).join(" · ").slice(0, 300),
    itemsSummary: g.contents.slice(0, 200),
    externalRef: `guest:${g.id}`,
    eventSource: "CLIENT",
  });
  await prisma.guestShipment.update({ where: { id: g.id }, data: { orderId: order.id, pickupId: pickup.id } });
  await addOrderEvent(prisma, { orderId: order.id, type: "guest_paid", source: "SYSTEM", note: `Envío sin registro pagado ($${Number(g.price)}). Remitente ${g.senderName}, ${g.senderPhone}, ${g.senderEmail}` }).catch(() => {});
  await audit(prisma, { action: "guest.paid", entity: "GuestShipment", entityId: g.id, summary: `Envío sin registro ${order.code} pagado por ${g.senderName}` });
  await sendPush(prisma, await adminUserIds(prisma), {
    title: "Nuevo envío sin registro pagado",
    body: `${order.code}: recolectar con ${g.senderName} el ${ymd} y entregar en ${g.city}`,
    url: `/admin/pedidos/${order.id}`,
  }).catch(() => {});
  return order;
}

/** Estado para la página pública del remitente (por su token). */
export async function guestStatus(prisma: PrismaClient, token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return prisma.guestShipment.findUnique({
    where: { token },
    include: { order: { select: { id: true, code: true, status: true, deliveredAt: true } }, checkout: { select: { status: true } } },
  });
}

