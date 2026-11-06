import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NOTIFY_EVENTS, whatsappTemplatePayload, type NotifyEvent } from "@packatelas/db";

const GRAPH = "https://graph.facebook.com/v21.0";
const cfg = () => {
  const token = process.env.WHATSAPP_TOKEN?.trim(), waba = process.env.WHATSAPP_WABA_ID?.trim();
  return token && waba ? { token, waba } : null;
};

export type TemplateStatus = { template: string; label: string; status: string; reason?: string; category?: string; id?: string; outdated?: boolean };

type MetaComponent = { type: string; text?: string; buttons?: { type: string; text?: string; url?: string }[] };
/** Texto y botones, para comparar lo que hay en Meta con lo que espera el portal. */
const shape = (comps: MetaComponent[] | undefined) =>
  JSON.stringify((comps ?? []).filter((c) => ["BODY", "BUTTONS"].includes(c.type.toUpperCase())).map((c) => ({
    type: c.type.toUpperCase(), text: c.text ?? null, buttons: (c.buttons ?? []).map((b) => ({ type: b.type.toUpperCase(), text: b.text ?? null, url: b.url ?? null })),
  })));

/** Estado de nuestras plantillas en Meta (APPROVED, PENDING, REJECTED o "No registrada"). */
export async function templateStatuses(): Promise<TemplateStatus[] | null> {
  const c = cfg();
  if (!c) return null;
  try {
    const res = await fetch(`${GRAPH}/${c.waba}/message_templates?fields=id,name,status,rejected_reason,language,category,components&limit=200`, { headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { data?: { id: string; name: string; status: string; rejected_reason?: string; language: string; category?: string; components?: MetaComponent[] }[]; error?: { message: string } };
    if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    return (Object.keys(NOTIFY_EVENTS) as NotifyEvent[]).map((k) => {
      const t = j.data?.find((d) => d.name === NOTIFY_EVENTS[k].template && d.language === "es_MX");
      const outdated = !!t && shape(t.components) !== shape(whatsappTemplatePayload(k).components as MetaComponent[]);
      return { template: NOTIFY_EVENTS[k].template, label: NOTIFY_EVENTS[k].label, status: t?.status ?? "No registrada", reason: t?.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : undefined, category: t?.category, id: t?.id, outdated };
    });
  } catch (e) {
    return [{ template: "—", label: "Error al consultar Meta", status: e instanceof Error ? e.message : "Error" }];
  }
}

/** Registra en Meta las plantillas que falten. Las ya existentes no se tocan. */
export async function registerTemplates(): Promise<{ created: string[]; errors: string[] }> {
  const c = cfg();
  if (!c) return { created: [], errors: ["Faltan WHATSAPP_TOKEN o WHATSAPP_WABA_ID en Coolify"] };
  const current = (await templateStatuses()) ?? [];
  const created: string[] = [], errors: string[] = [];
  for (const k of Object.keys(NOTIFY_EVENTS) as NotifyEvent[]) {
    if (current.find((t) => t.template === NOTIFY_EVENTS[k].template && t.status !== "No registrada")) continue;
    const res = await fetch(`${GRAPH}/${c.waba}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(whatsappTemplatePayload(k)),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } };
    if (res.ok) created.push(NOTIFY_EVENTS[k].template);
    else errors.push(`${NOTIFY_EVENTS[k].template}: ${j.error?.error_user_msg ?? j.error?.message ?? res.status}`);
  }
  return { created, errors };
}

/** Manda a Meta el texto y los botones actuales de las plantillas que cambiaron (vuelven a revisión). */
export async function updateOutdatedTemplates(): Promise<{ updated: string[]; errors: string[] }> {
  const c = cfg();
  if (!c) return { updated: [], errors: ["Faltan WHATSAPP_TOKEN o WHATSAPP_WABA_ID en Coolify"] };
  const current = (await templateStatuses()) ?? [];
  const updated: string[] = [], errors: string[] = [];
  for (const k of Object.keys(NOTIFY_EVENTS) as NotifyEvent[]) {
    const t = current.find((x) => x.template === NOTIFY_EVENTS[k].template);
    if (!t?.id || !t.outdated) continue;
    const res = await fetch(`${GRAPH}/${t.id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ components: whatsappTemplatePayload(k).components }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } };
    if (res.ok) updated.push(t.template);
    else errors.push(`${t.template}: ${j.error?.error_user_msg ?? j.error?.message ?? res.status}`);
  }
  return { updated, errors };
}

const phoneCfg = () => {
  const token = process.env.WHATSAPP_TOKEN?.trim(), phone = process.env.WHATSAPP_PHONE_ID?.trim();
  return token && phone ? { token, phone } : null;
};

export type PhoneStatus = { number?: string; name?: string; nameStatus?: string; status?: string; verified?: string; quality?: string; limit?: string; error?: string } | null;

/** Estado del número en Meta (para saber si ya puede mandar). */
export async function phoneStatus(): Promise<PhoneStatus> {
  const c = phoneCfg();
  if (!c) return null;
  try {
    const res = await fetch(`${GRAPH}/${c.phone}?fields=display_phone_number,verified_name,name_status,status,code_verification_status,quality_rating,messaging_limit_tier`, { headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as Record<string, string> & { error?: { message: string } };
    if (!res.ok) return { error: j.error?.message ?? `HTTP ${res.status}` };
    return { number: j.display_phone_number, name: j.verified_name, nameStatus: j.name_status, status: j.status, verified: j.code_verification_status, quality: j.quality_rating, limit: j.messaging_limit_tier };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error" };
  }
}

/** Registra el número en la API de WhatsApp con el PIN de verificación en dos pasos (6 dígitos). */
export async function registerPhone(pin: string): Promise<{ ok: boolean; error?: string }> {
  const c = phoneCfg();
  if (!c) return { ok: false, error: "Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID en Coolify" };
  const res = await fetch(`${GRAPH}/${c.phone}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; error_user_msg?: string } };
  return res.ok && j.success ? { ok: true } : { ok: false, error: j.error?.error_user_msg ?? j.error?.message ?? `HTTP ${res.status}` };
}

/** Token para que Meta verifique el webhook (se deriva de ENCRYPTION_KEY; no hay que guardarlo aparte). */
export function webhookVerifyToken() {
  const k = process.env.ENCRYPTION_KEY?.trim();
  return k ? createHmac("sha256", k).update("whatsapp-webhook").digest("base64url").slice(0, 24) : null;
}

/** Firma X-Hub-Signature-256 de Meta con el App Secret. */
export function validWebhookSignature(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret || !header?.startsWith("sha256=")) return false;
  const a = Buffer.from(header.slice(7), "hex");
  const b = createHmac("sha256", secret).update(raw).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Apps suscritas a los avisos (webhook) de la cuenta de WhatsApp. */
export async function webhookSubscriptions(): Promise<string[] | null> {
  const c = cfg();
  if (!c) return null;
  try {
    const res = await fetch(`${GRAPH}/${c.waba}/subscribed_apps`, { headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { data?: { whatsapp_business_api_data?: { name?: string; id?: string } }[] };
    return (j.data ?? []).map((d) => d.whatsapp_business_api_data?.name ?? d.whatsapp_business_api_data?.id ?? "app");
  } catch {
    return null;
  }
}

/** Suscribe la app del token a los avisos de la cuenta (sin esto Meta no manda entregado/leído). */
export async function subscribeWebhook(): Promise<{ ok: boolean; error?: string }> {
  const c = cfg();
  if (!c) return { ok: false, error: "Faltan WHATSAPP_TOKEN o WHATSAPP_WABA_ID" };
  const res = await fetch(`${GRAPH}/${c.waba}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
  return res.ok && j.success ? { ok: true } : { ok: false, error: j.error?.message ?? `HTTP ${res.status}` };
}

/** Mensaje de texto libre (solo válido dentro de las 24 h después de que la persona nos escribió). Devuelve el id del mensaje o null. */
export async function sendWhatsappText(to: string, text: string): Promise<string | null> {
  const r = await sendWhatsappTextDetailed(to, text);
  return r.ok ? r.id : null;
}

export async function sendWhatsappTextDetailed(to: string, text: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const c = phoneCfg();
  if (!c) return { ok: false, error: "Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID" };
  try {
    const res = await fetch(`${GRAPH}/${c.phone}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4000), preview_url: true } }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (res.ok && j.messages?.[0]?.id) return { ok: true, id: j.messages[0].id };
    return { ok: false, error: j.error?.code === 131047 ? "Pasaron más de 24 h desde su último mensaje: ya no se puede responder con texto libre" : (j.error?.message ?? `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

/** Descarga un archivo que mandó alguien por WhatsApp (imagen, audio, documento). */
export async function fetchWhatsappMedia(mediaId: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const c = phoneCfg();
  if (!c || !/^\d{5,30}$/.test(mediaId)) return null;
  const meta = (await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null)) as { url?: string; mime_type?: string } | null;
  if (!meta?.url) return null;
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  return { data: await res.arrayBuffer(), mime: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
}
