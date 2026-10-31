import "server-only";
import { NOTIFY_EVENTS, whatsappTemplatePayload, type NotifyEvent } from "@packatelas/db";

const GRAPH = "https://graph.facebook.com/v21.0";
const cfg = () => {
  const token = process.env.WHATSAPP_TOKEN?.trim(), waba = process.env.WHATSAPP_WABA_ID?.trim();
  return token && waba ? { token, waba } : null;
};

export type TemplateStatus = { template: string; label: string; status: string; reason?: string };

/** Estado de nuestras plantillas en Meta (APPROVED, PENDING, REJECTED o "No registrada"). */
export async function templateStatuses(): Promise<TemplateStatus[] | null> {
  const c = cfg();
  if (!c) return null;
  try {
    const res = await fetch(`${GRAPH}/${c.waba}/message_templates?fields=name,status,rejected_reason,language&limit=200`, { headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { data?: { name: string; status: string; rejected_reason?: string; language: string }[]; error?: { message: string } };
    if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    return (Object.keys(NOTIFY_EVENTS) as NotifyEvent[]).map((k) => {
      const t = j.data?.find((d) => d.name === NOTIFY_EVENTS[k].template && d.language === "es_MX");
      return { template: NOTIFY_EVENTS[k].template, label: NOTIFY_EVENTS[k].label, status: t?.status ?? "No registrada", reason: t?.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : undefined };
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
