// Envío por la API oficial de WhatsApp (Cloud API de Meta) con plantillas aprobadas [I04].
import type { Sender } from "@packatelas/db";

export function whatsappSender(env = process.env): Sender | null {
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneId = env.WHATSAPP_PHONE_ID?.trim();
  if (!token || !phoneId) return null;
  const lang = env.WHATSAPP_LANG?.trim() || "es_MX";
  return async ({ to, template, params }) => {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: template,
            language: { code: lang },
            components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
      if (res.ok && j.messages?.[0]?.id) return { ok: true, id: j.messages[0].id };
      const msg = j.error?.message ?? `HTTP ${res.status}`;
      // 4xx (plantilla inexistente, número inválido, sin permiso) no se arregla reintentando.
      return { ok: false, error: msg, permanent: res.status >= 400 && res.status < 500 && res.status !== 429 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
    }
  };
}
