// Avisos por WhatsApp [C11, C12, F10, I04]. Todo aviso se registra primero en la bitácora
// (Notification) y el proceso en segundo plano lo envía con la API oficial de WhatsApp (Meta).
// Sin credenciales se marca "omitido" para que se vea qué se habría mandado.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export type NotifyEvent = "en_camino" | "entregado" | "no_entregado" | "regresa_bodega" | "recoleccion_asignada" | "recoleccion_en_camino" | "recoleccion_bloqueada" | "recordatorio_pago";

/** Plantillas: deben darse de alta igual (nombre y número de variables) en WhatsApp Manager. */
export const NOTIFY_EVENTS: Record<NotifyEvent, { label: string; audience: "Comprador" | "Tienda"; template: string; text: string; example: string[] }> = {
  // Reglas de Meta: el texto no puede empezar ni terminar con una variable.
  en_camino: { label: "Envío en camino", audience: "Comprador", template: "pk_en_camino", text: "Hola {{1}}, tu pedido de {{2}} ({{3}}) ya va en camino. Puedes seguirlo aquí: {{4}} ¡Gracias por tu compra!", example: ["Ana", "Tienda Ejemplo", "ML-48341193826", "https://nuevo.packatelas.mx/s/abc"] },
  entregado: { label: "Envío entregado", audience: "Comprador", template: "pk_entregado", text: "Hola {{1}}, entregamos tu pedido de {{2}} ({{3}}). ¡Gracias!", example: ["Ana", "Tienda Ejemplo", "ML-48341193826"] },
  no_entregado: { label: "No se pudo entregar", audience: "Comprador", template: "pk_no_entregado", text: "Hola {{1}}, no pudimos entregar tu pedido de {{2}}. Motivo: {{3}}. Detalles en {{4}} y te contactaremos para reprogramar.", example: ["Ana", "Tienda Ejemplo", "No había nadie en el domicilio", "https://nuevo.packatelas.mx/s/abc"] },
  regresa_bodega: { label: "Paquete regresa a la tienda", audience: "Tienda", template: "pk_regresa_bodega", text: "Hola {{1}}, el envío {{2}} no se pudo entregar ({{3}}) y regresará a tu tienda.", example: ["Tienda Ejemplo", "ML-48341193826", "dirección incorrecta"] },
  recoleccion_asignada: { label: "Recolección asignada", audience: "Tienda", template: "pk_recoleccion_asignada", text: "Hola {{1}}, tu recolección del {{2}} en {{3}} quedó asignada a {{4}}. Te mandaremos el enlace para seguirlo en vivo cuando vaya en camino a tu dirección.", example: ["Tienda Ejemplo", "sábado 31 de octubre", "Sucursal Centro", "Juan"] },
  recoleccion_en_camino: { label: "Recolección en camino", audience: "Tienda", template: "pk_recoleccion_en_camino", text: "Hola {{1}}, {{2}} ya va en camino a {{3}} para recoger tus paquetes. Síguelo en tiempo real aquí: {{4}} Ten listos tus envíos, por favor.", example: ["Tienda Ejemplo", "Juan", "Sucursal Centro", "https://nuevo.packatelas.mx/s/abc"] },
  recoleccion_bloqueada: { label: "Recolección en pausa por adeudo", audience: "Tienda", template: "pk_recoleccion_pausa", text: "Hola {{1}}, tu recolección está en pausa por un saldo pendiente de {{2}}. Paga con la referencia {{3}} para reactivarla.", example: ["Tienda Ejemplo", "$1,150.00", "CMX00151"] },
  recordatorio_pago: { label: "Recordatorio de pago", audience: "Tienda", template: "pk_recordatorio_pago", text: "Hola {{1}}, tu saldo con Packatelas es de {{2}}. Transfiere con la referencia {{3}} antes del {{4}} para que tus recolecciones sigan activas.", example: ["Tienda Ejemplo", "$1,150.00", "CMX00151", "lunes 2 de noviembre"] },
};

/** Cuerpo para registrar la plantilla en Meta (POST /{waba}/message_templates). */
export function whatsappTemplatePayload(event: NotifyEvent, language = "es_MX") {
  const e = NOTIFY_EVENTS[event];
  return { name: e.template, language, category: "UTILITY", components: [{ type: "BODY", text: e.text, example: { body_text: [e.example] } }] };
}

export type NotifySettings = { enabled: Record<NotifyEvent, boolean>; reminderWeekday: number; reminderHour: number };
const KEY = "notify.settings";
export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: { en_camino: true, entregado: true, no_entregado: true, regresa_bodega: true, recoleccion_asignada: true, recoleccion_en_camino: true, recoleccion_bloqueada: true, recordatorio_pago: true },
  reminderWeekday: 6, // sábado
  reminderHour: 10,
};

export async function getNotifySettings(db: Db): Promise<NotifySettings> {
  const v = ((await db.setting.findUnique({ where: { key: KEY } }))?.value ?? {}) as Partial<NotifySettings>;
  return {
    enabled: { ...DEFAULT_NOTIFY.enabled, ...(v.enabled ?? {}) },
    reminderWeekday: v.reminderWeekday && v.reminderWeekday >= 1 && v.reminderWeekday <= 7 ? v.reminderWeekday : DEFAULT_NOTIFY.reminderWeekday,
    reminderHour: v.reminderHour != null && v.reminderHour >= 0 && v.reminderHour <= 23 ? v.reminderHour : DEFAULT_NOTIFY.reminderHour,
  };
}

export async function setNotifySettings(prisma: PrismaClient, s: NotifySettings, actorUserId?: string) {
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: s }, create: { key: KEY, value: s } });
  await audit(prisma, { actorUserId, action: "settings.notifications", entity: "Setting", entityId: KEY, summary: "Configuración de avisos actualizada" });
}

/** Teléfono a formato WhatsApp de México (52 + 10 dígitos); null si no sirve. */
export function waPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `52${d}`;
  if (d.length === 12 && d.startsWith("52")) return d;
  if (d.length === 13 && d.startsWith("521")) return `52${d.slice(3)}`;
  return null;
}

export const renderPreview = (event: NotifyEvent, params: string[]) =>
  NOTIFY_EVENTS[event].text.replace(/\{\{(\d)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");

/** Registra un aviso (una sola vez por dedupeKey). Devuelve false si no aplica. */
export async function enqueueNotification(
  db: Db,
  n: { event: NotifyEvent; to: string | null | undefined; params: string[]; dedupeKey: string; orderId?: string; clientId?: string },
): Promise<boolean> {
  const settings = await getNotifySettings(db);
  if (!settings.enabled[n.event]) return false;
  const to = waPhone(n.to);
  if (!to) return false;
  const params = n.params.map((p) => (p ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "-");
  try {
    await db.notification.create({
      data: { event: n.event, to, template: NOTIFY_EVENTS[n.event].template, params, preview: renderPreview(n.event, params), dedupeKey: n.dedupeKey, orderId: n.orderId, clientId: n.clientId },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false; // ya estaba
    throw e;
  }
}

const money = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
const firstName = (s?: string | null) => (s ?? "").trim().split(/\s+/)[0] || "hola";

/** Avisos al comprador (y a la tienda) según lo que acaba de pasar con el pedido. */
export async function notifyOrderStatus(db: Db, orderId: string, opts: { trackingUrl: string }) {
  const o = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, code: true, kind: true, status: true, recipientName: true, recipientPhone: true, attempts: true, clientId: true,
      client: { select: { name: true, phone: true } },
      events: { where: { type: { in: ["failed", "return_required"] } }, orderBy: { occurredAt: "desc" }, take: 1, select: { note: true } },
    },
  });
  if (!o || o.kind !== "DELIVERY") return;
  const store = o.client.name;
  const reason = o.events[0]?.note?.split(" · ")[0] ?? "no fue posible";
  const base = { orderId: o.id, clientId: o.clientId };
  if (o.status === "OUT_FOR_DELIVERY") {
    await enqueueNotification(db, { ...base, event: "en_camino", to: o.recipientPhone, params: [firstName(o.recipientName), store, o.code, opts.trackingUrl], dedupeKey: `en_camino:${o.id}:${o.attempts}` });
  } else if (o.status === "DELIVERED") {
    await enqueueNotification(db, { ...base, event: "entregado", to: o.recipientPhone, params: [firstName(o.recipientName), store, o.code], dedupeKey: `entregado:${o.id}` });
  } else if (o.status === "FAILED" || o.status === "RETURNING") {
    await enqueueNotification(db, { ...base, event: "no_entregado", to: o.recipientPhone, params: [firstName(o.recipientName), store, reason.toLowerCase(), opts.trackingUrl], dedupeKey: `no_entregado:${o.id}:${o.attempts}` });
    if (o.status === "RETURNING") {
      await enqueueNotification(db, { ...base, event: "regresa_bodega", to: o.client.phone, params: [store, o.code, reason.toLowerCase()], dedupeKey: `regresa_bodega:${o.id}` });
    }
  }
}

const YMD_MX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const ymdMx = (d: Date) => YMD_MX.format(d);

/** Aviso a la tienda cuando su recolección queda en pausa (uno por día). */
export async function notifyPickupBlocked(db: Db, clientId: string, now = new Date()) {
  const c = await db.client.findUnique({ where: { id: clientId }, select: { name: true, contactName: true, phone: true, paymentReference: true } });
  if (!c) return false;
  const bal = await db.ledgerEntry.aggregate({ where: { clientId }, _sum: { amount: true } });
  return enqueueNotification(db, {
    event: "recoleccion_bloqueada", to: c.phone, clientId,
    params: [c.contactName ? firstName(c.contactName) : c.name, money(Number(bal._sum.amount ?? 0)), c.paymentReference],
    dedupeKey: `recoleccion_bloqueada:${clientId}:${ymdMx(now)}`,
  });
}

/** Recordatorio semanal de pago a quien debe (día y hora configurables) [F10]. */
export async function sendWeeklyReminders(prisma: PrismaClient, now = new Date(), cutoffLabel = "lunes") {
  const s = await getNotifySettings(prisma);
  const local = new Date(now.getTime() - 6 * 3600_000);
  const weekday = ((local.getUTCDay() + 6) % 7) + 1;
  if (weekday !== s.reminderWeekday || local.getUTCHours() < s.reminderHour) return 0;
  const owing = await prisma.ledgerEntry.groupBy({ by: ["clientId"], _sum: { amount: true }, having: { amount: { _sum: { gt: 0 } } } });
  const clients = await prisma.client.findMany({
    where: { id: { in: owing.map((o) => o.clientId) }, active: true, phone: { not: null } },
    select: { id: true, name: true, contactName: true, phone: true, paymentReference: true },
  });
  const bal = new Map(owing.map((o) => [o.clientId, Number(o._sum.amount ?? 0)]));
  let n = 0;
  for (const c of clients) {
    const ok = await enqueueNotification(prisma, {
      event: "recordatorio_pago", to: c.phone, clientId: c.id,
      params: [c.contactName ? firstName(c.contactName) : c.name, money(bal.get(c.id) ?? 0), c.paymentReference, cutoffLabel],
      dedupeKey: `recordatorio_pago:${c.id}:${ymdMx(now)}`,
    });
    if (ok) n++;
  }
  return n;
}

export type Sender = (n: { to: string; template: string; params: string[] }) => Promise<{ ok: true; id?: string } | { ok: false; error: string; permanent?: boolean }>;

/** Envía lo pendiente. Sin `sender` (sin credenciales) lo marca como omitido. */
export async function deliverPending(prisma: PrismaClient, sender: Sender | null, limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const items = await prisma.notification.findMany({
    where: { status: "PENDING", attempts: { lt: 5 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const out = { sent: 0, failed: 0, skipped: 0 };
  for (const n of items) {
    if (!sender || Date.now() - n.createdAt.getTime() > 48 * 3600_000) {
      await prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: sender ? "Vencido (más de 48 h)" : "Sin credenciales de WhatsApp" } });
      out.skipped++;
      continue;
    }
    // Reserva el aviso para que dos procesos no lo manden a la vez.
    const claimed = await prisma.notification.updateMany({ where: { id: n.id, status: "PENDING", attempts: n.attempts }, data: { attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    const r = await sender({ to: n.to, template: n.template, params: n.params as string[] });
    if (r.ok) {
      await prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), externalId: r.id, error: null } });
      out.sent++;
    } else {
      const last = r.permanent || n.attempts + 1 >= 5;
      await prisma.notification.update({ where: { id: n.id }, data: { status: last ? "FAILED" : "PENDING", error: r.error.slice(0, 500) } });
      if (last) out.failed++;
    }
  }
  return out;
}

// ── Salud operativa [A20] ─────────────────────────────────────────────────

export type HealthEntry = { at: string; ok: boolean; detail?: string };

export async function reportHealth(db: Db, component: string, ok: boolean, detail?: string) {
  const value: HealthEntry = { at: new Date().toISOString(), ok, detail: detail?.slice(0, 500) };
  await db.setting.upsert({ where: { key: `health.${component}` }, update: { value }, create: { key: `health.${component}`, value } });
}

export async function readHealth(db: Db): Promise<Record<string, HealthEntry>> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: "health." } } });
  return Object.fromEntries(rows.map((r) => [r.key.slice(7), r.value as HealthEntry]));
}
