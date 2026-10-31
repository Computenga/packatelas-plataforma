import { applyWhatsappStatuses, prisma } from "@packatelas/db";
import { validWebhookSignature, webhookVerifyToken } from "@/lib/wa-templates";

/** Verificación del webhook que hace Meta al configurarlo. */
export function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const token = webhookVerifyToken();
  if (p.get("hub.mode") === "subscribe" && token && p.get("hub.verify_token") === token) return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  return new Response("forbidden", { status: 403 });
}

/** Estados de entrega de los avisos (enviado, entregado, leído, falló). Solo se aceptan avisos firmados por Meta. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1_000_000 || !validWebhookSignature(raw, request.headers.get("x-hub-signature-256"))) return new Response("forbidden", { status: 403 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok");
  }
  await applyWhatsappStatuses(prisma, body).catch((e) => console.error("[whatsapp webhook]", e instanceof Error ? e.message : e));
  return new Response("ok");
}
