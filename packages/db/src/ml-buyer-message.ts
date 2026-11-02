// Aviso al comprador por la mensajería de Mercado Libre [I13].
// Buena práctica (documentación de ML, «Motivos para comunicarse»): en envíos Mercado Envíos 2 el vendedor
// solo puede iniciar la conversación con un motivo. Para Flex existe DELIVERY_PROMISE: una PLANTILLA
// de Mercado Libre («Entregaremos tu compra hoy entre las X y las Y hs»). Al ser texto de ML no pasa por
// moderación, no lleva links ni datos de contacto y no se puede marcar como desvío fuera de la plataforma.
// Una sola vez por venta (ML lo limita con cap_available). Apagado por omisión; requiere que la app
// de ML tenga el permiso de «Comunicaciones post venta».
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { mlAccessToken } from "./ml-api.ts";
import { addOrderEvent } from "./orders.ts";

type Fetch = typeof fetch;
const API = "https://api.mercadolibre.com";
const KEY = "ml.buyer_message";

export type BuyerMessageSettings = { enabled: boolean; fromHour: number; toHour: number; trigger: "ASSIGNED" | "OUT_FOR_DELIVERY" };
const DEFAULTS: BuyerMessageSettings = { enabled: false, fromHour: 12, toHour: 21, trigger: "ASSIGNED" };

export async function getBuyerMessageSettings(db: PrismaClient | Prisma.TransactionClient): Promise<BuyerMessageSettings> {
  const v = ((await db.setting.findUnique({ where: { key: KEY } }))?.value ?? {}) as Partial<BuyerMessageSettings>;
  return { ...DEFAULTS, ...v };
}

export async function saveBuyerMessageSettings(prisma: PrismaClient, s: BuyerMessageSettings) {
  if (!(s.fromHour >= 7 && s.toHour <= 23 && s.fromHour < s.toHour)) throw new Error("Horario inválido: de 7 a 23 h, y el inicio antes del fin");
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: s }, update: { value: s } });
}

/** Texto que verá el comprador (lo arma Mercado Libre; aquí solo para mostrarlo). */
export const buyerMessagePreview = (s: Pick<BuyerMessageSettings, "fromHour" | "toHour">) => `Entregaremos tu compra hoy entre las ${s.fromHour} y las ${s.toHour} hs.`;

type Result = { status: "sent" | "no_cap" | "not_flex" | "no_account" | "unauthorized" | "already" | "error"; detail?: string };

/** Manda la promesa de entrega de un pedido Flex. Idempotente: deja rastro en el historial del pedido. */
export async function sendDeliveryPromise(prisma: PrismaClient, orderId: string, s: BuyerMessageSettings, fetchImpl: Fetch = fetch): Promise<Result> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, source: true, mlAccountId: true, mlOrderId: true, mlPackId: true } });
  if (!order || order.source !== "ML_FLEX") return { status: "not_flex" };
  if (await prisma.orderEvent.findFirst({ where: { orderId, type: "ml_buyer_message" }, select: { id: true } })) return { status: "already" };
  const packId = order.mlPackId ?? order.mlOrderId; // sin carrito, ML usa el id de la orden como pack
  if (!order.mlAccountId || !packId) return { status: "no_account" };
  const token = await mlAccessToken(prisma, order.mlAccountId, fetchImpl).catch(() => null);
  if (!token) return { status: "unauthorized" };

  const record = (status: Result["status"], detail?: string) =>
    addOrderEvent(prisma, {
      orderId,
      type: "ml_buyer_message",
      source: "SYSTEM",
      note: status === "sent" ? `Aviso al comprador en Mercado Libre: «${buyerMessagePreview(s)}»` : `Aviso al comprador no enviado (${detail ?? status})`,
      data: { status, detail: detail ?? null },
    }).then(() => ({ status, detail }));

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // ¿Sigue disponible el motivo para esta venta?
  const opts = await fetchImpl(`${API}/messages/action_guide/packs/${packId}?tag=post_sale`, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (opts?.status === 401) return { status: "unauthorized" };
  // 403: la app no tiene el permiso de mensajería o la venta no lo permite; se anota para no insistir.
  if (opts?.status === 403) return record("unauthorized", `sin permiso de mensajería (${(await opts.text().catch(() => "")).slice(0, 120)})`);
  if (opts?.ok) {
    const j = (await opts.json().catch(() => ({}))) as { options?: { id: string; cap_available?: number; enabled?: boolean }[] };
    const opt = j.options?.find((o) => o.id === "DELIVERY_PROMISE");
    if (j.options && (!opt || opt.enabled === false || (opt.cap_available ?? 1) < 1)) return record("no_cap", opt ? "ya se usó" : "Mercado Libre no ofrece el motivo para esta venta");
  }
  const res = await fetchImpl(`${API}/messages/action_guide/packs/${packId}/option?tag=post_sale`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      option_id: "DELIVERY_PROMISE",
      template_id: "TEMPLATE___DELIVERY_PROMISE___1",
      vars: [
        { id: "TEMPLATE___DELIVERY_PROMISE___1___VAR___INIT", value: s.fromHour },
        { id: "TEMPLATE___DELIVERY_PROMISE___1___VAR___LIMIT", value: s.toHour },
      ],
    }),
  }).catch((e) => e as Error);
  if (res instanceof Error) return { status: "error", detail: res.message }; // red: se reintenta en la siguiente vuelta
  if (res.ok) return record("sent");
  const body = (await res.text().catch(() => "")).slice(0, 160);
  if (res.status === 401) return { status: "unauthorized" };
  if (res.status === 409) return { status: "error", detail: "venta bloqueada por otra solicitud" };
  return record(res.status === 403 && /limit/i.test(body) ? "no_cap" : "error", `${res.status} ${body}`);
}

/** Una vuelta: avisa a los compradores de pedidos Flex que ya van en ruta hoy. */
export async function processBuyerMessages(prisma: PrismaClient, fetchImpl: Fetch = fetch, now = new Date()) {
  const s = await getBuyerMessageSettings(prisma);
  if (!s.enabled) return { sent: 0, checked: 0 };
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour >= s.toHour) return { sent: 0, checked: 0 }; // ya no sería «hoy entre…»
  const statuses = s.trigger === "ASSIGNED" ? ["ASSIGNED", "OUT_FOR_DELIVERY"] : ["OUT_FOR_DELIVERY"];
  const orders = await prisma.order.findMany({
    where: {
      source: "ML_FLEX",
      status: { in: statuses as never },
      updatedAt: { gte: new Date(now.getTime() - 18 * 3600_000) },
      events: { none: { type: "ml_buyer_message" } },
      mlAccount: { status: "ACTIVE" },
    },
    select: { id: true },
    take: 40,
  });
  // La ventana empieza a partir de la siguiente hora (no prometer algo que ya pasó).
  const win = { ...s, fromHour: Math.max(s.fromHour, Math.min(hour + 1, s.toHour - 1)) };
  let sent = 0;
  for (const o of orders) {
    const r = await sendDeliveryPromise(prisma, o.id, win, fetchImpl).catch(() => null);
    if (r?.status === "sent") sent++;
  }
  return { sent, checked: orders.length };
}
