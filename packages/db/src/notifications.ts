// Avisos por WhatsApp [C11, C12, F10, I04]. Todo aviso se registra primero en la bitácora
// (Notification) y el proceso en segundo plano lo envía con la API oficial de WhatsApp (Meta).
// Sin credenciales se marca "omitido" para que se vea qué se habría mandado.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export type NotifyEvent = "en_camino" | "entregado" | "no_entregado" | "regresa_bodega" | "recoleccion_asignada" | "recoleccion_en_camino" | "recoleccion_bloqueada" | "recordatorio_pago" | "bienvenida_registro" | "recoleccion_creada";

/** Plantillas: deben darse de alta igual (nombre y número de variables) en WhatsApp Manager. */
export const NOTIFY_EVENTS: Record<NotifyEvent, { label: string; audience: "Comprador" | "Tienda"; template: string; text: string; example: string[] }> = {
  // Reglas de Meta: el texto no puede empezar ni terminar con una variable.
  en_camino: { label: "Envío en camino", audience: "Comprador", template: "pk_en_camino", text: "Hola {{1}}, tu pedido de {{2}} ({{3}}) ya va en camino. Puedes seguirlo aquí: {{4}} ¡Gracias por tu compra!", example: ["Ana", "Tienda Ejemplo", "ML-48341193826", "https://nuevo.packatelas.mx/s/abc"] },
  entregado: { label: "Envío entregado", audience: "Comprador", template: "pk_envio_entregado", text: "Hola {{1}}, entregamos tu pedido de {{2}} ({{3}}). ¡Gracias por tu compra!", example: ["Ana", "Tienda Ejemplo", "ML-48341193826"] },
  no_entregado: { label: "No se pudo entregar", audience: "Comprador", template: "pk_no_entregado", text: "Hola {{1}}, no pudimos entregar tu pedido de {{2}}. Motivo: {{3}}. Detalles en {{4}} y te contactaremos para reprogramar.", example: ["Ana", "Tienda Ejemplo", "No había nadie en el domicilio", "https://nuevo.packatelas.mx/s/abc"] },
  regresa_bodega: { label: "Paquete regresa a la tienda", audience: "Tienda", template: "pk_regresa_bodega", text: "Hola {{1}}, el envío {{2}} no se pudo entregar ({{3}}) y regresará a tu tienda.", example: ["Tienda Ejemplo", "ML-48341193826", "dirección incorrecta"] },
  recoleccion_creada: { label: "Recolección registrada (con folio)", audience: "Tienda", template: "pk_recoleccion_creada", text: "Hola {{1}}, registramos tu recolección con folio {{2}} para el {{3}} en {{4}}. Cuando el repartidor vaya en camino te mandaremos un enlace para seguirlo en tiempo real.", example: ["Tienda Ejemplo", "RC-000123", "lunes 3 de noviembre", "Sucursal Centro"] },
  recoleccion_asignada: { label: "Recolección asignada", audience: "Tienda", template: "pk_recoleccion_asignada", text: "Hola {{1}}, tu recolección del {{2}} en {{3}} quedó asignada a {{4}}. Te mandaremos el enlace para seguirlo en vivo cuando vaya en camino a tu dirección.", example: ["Tienda Ejemplo", "sábado 31 de octubre", "Sucursal Centro", "Juan"] },
  recoleccion_en_camino: { label: "Recolección en camino", audience: "Tienda", template: "pk_recoleccion_en_camino", text: "Hola {{1}}, {{2}} ya va en camino a {{3}} para recoger tus paquetes. Síguelo en tiempo real aquí: {{4}} Ten listos tus envíos, por favor.", example: ["Tienda Ejemplo", "Juan", "Sucursal Centro", "https://nuevo.packatelas.mx/s/abc"] },
  recoleccion_bloqueada: { label: "Recolección en pausa por adeudo", audience: "Tienda", template: "pk_recoleccion_pausa", text: "Hola {{1}}, tu recolección está en pausa por un saldo pendiente de {{2}}. Paga con la referencia {{3}} para reactivarla.", example: ["Tienda Ejemplo", "$1,150.00", "CMX00151"] },
  bienvenida_registro: { label: "Bienvenida a quien se registra", audience: "Tienda", template: "pk_bienvenida_registro", text: "Hola {{1}}, recibimos el registro de {{2}} en Packatelas. En breve te contactamos para terminar tu alta y agendar tu primera recolección. ¡Gracias por elegirnos!", example: ["Ana", "Tienda Ejemplo"] },
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
  // A compradores solo en pedidos externos (los de ML los avisa MercadoLibre); a las tiendas solo
  // «recolección registrada» y «en camino». Lo demás queda apagado y se puede prender en Avisos.
  enabled: { en_camino: true, entregado: true, no_entregado: true, regresa_bodega: false, recoleccion_creada: true, recoleccion_asignada: false, recoleccion_en_camino: true, recoleccion_bloqueada: false, recordatorio_pago: false, bienvenida_registro: false },
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
  if (await isOptedOut(db, to)) return false;
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
      id: true, code: true, kind: true, status: true, mlShipmentId: true, recipientName: true, recipientPhone: true, attempts: true, clientId: true,
      client: { select: { name: true, phone: true } },
      events: { where: { type: { in: ["failed", "return_required"] } }, orderBy: { occurredAt: "desc" }, take: 1, select: { note: true } },
    },
  });
  if (!o || o.kind !== "DELIVERY") return;
  // Envíos de MercadoLibre: al comprador lo avisa ML; solo avisamos en pedidos externos.
  if (o.mlShipmentId != null) return;
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

// ── Bajas: quien responde «BAJA» deja de recibir avisos ──
const OPTOUT_KEY = "wa.optout";
async function optOutList(db: Db): Promise<string[]> {
  const v = (await db.setting.findUnique({ where: { key: OPTOUT_KEY } }))?.value;
  return Array.isArray(v) ? (v as string[]) : [];
}
export async function isOptedOut(db: Db, to: string) {
  return (await optOutList(db)).includes(to);
}
export async function setOptOut(db: Db, raw: string, out: boolean) {
  const to = waPhone(raw);
  if (!to) return false;
  const list = new Set(await optOutList(db));
  if (out) list.add(to);
  else list.delete(to);
  await db.setting.upsert({ where: { key: OPTOUT_KEY }, update: { value: [...list] }, create: { key: OPTOUT_KEY, value: [...list] } });
  return true;
}

// ── Estados de entrega que manda WhatsApp (webhook) ──
type WaStatus = { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] };

const WA_ERROR_ES: Record<number, string> = {
  131042: "Falta método de pago en la cuenta de WhatsApp",
  131026: "El número no tiene WhatsApp o no puede recibir el mensaje",
  131047: "Pasaron más de 24 h desde el último mensaje de la persona",
  131049: "Meta no lo entregó para cuidar la experiencia del usuario (límite de mensajes de marketing)",
  131051: "Tipo de mensaje no soportado",
  132001: "La plantilla no existe o no está aprobada en ese idioma",
  131056: "Demasiados mensajes al mismo número en poco tiempo",
  130472: "El número es parte de un experimento de Meta y no recibió el mensaje",
};
const RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };

/** Aplica los estados (entregado, leído, falló) que reporta WhatsApp por webhook. */
export async function applyWhatsappStatuses(prisma: PrismaClient, body: unknown) {
  const statuses: WaStatus[] = [];
  const inbound: { from?: string; text?: { body?: string }; button?: { text?: string } }[] = [];
  for (const e of ((body as { entry?: { changes?: { value?: { statuses?: WaStatus[]; messages?: typeof inbound } }[] }[] })?.entry ?? [])) {
    for (const c of e.changes ?? []) {
      statuses.push(...(c.value?.statuses ?? []));
      inbound.push(...(c.value?.messages ?? []));
    }
  }
  // Mensajes que nos escriben: «BAJA» / «ALTA» para dejar o volver a recibir avisos.
  for (const m of inbound) {
    const t = (m.text?.body ?? m.button?.text ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!m.from) continue;
    if (/^(BAJA|STOP|ALTO|CANCELAR AVISOS)$/.test(t)) await setOptOut(prisma, m.from, true);
    else if (/^(ALTA|START)$/.test(t)) await setOptOut(prisma, m.from, false);
  }
  let n = 0;
  for (const s of statuses) {
    if (!s.id || !s.status) continue;
    const at = s.timestamp && /^\d+$/.test(s.timestamp) ? new Date(Number(s.timestamp) * 1000) : new Date();
    const row = await prisma.notification.findFirst({ where: { externalId: s.id } });
    if (!row) continue;
    if (s.status === "failed") {
      const err = s.errors?.[0];
      const why = (err?.code && WA_ERROR_ES[err.code]) || err?.error_data?.details || err?.title || err?.message || "WhatsApp no pudo entregarlo";
      await prisma.notification.update({ where: { id: row.id }, data: { status: "FAILED", error: `${why}${err?.code ? ` (${err.code})` : ""}`.slice(0, 500), statusAt: at } });
      n++;
      continue;
    }
    const next = s.status === "read" ? "READ" : s.status === "delivered" ? "DELIVERED" : s.status === "sent" ? "SENT" : null;
    // Los avisos pueden llegar desordenados: nunca se baja de "leído" a "entregado".
    if (!next || (RANK[row.status] ?? 0) >= RANK[next] || row.status === "FAILED") continue;
    await prisma.notification.update({ where: { id: row.id }, data: { status: next, statusAt: at, error: null } });
    n++;
  }
  return n;
}
