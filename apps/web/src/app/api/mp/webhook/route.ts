import { prisma, syncMpPayment, validMpSignature } from "@packatelas/db";

/**
 * Avisos de Mercado Pago [I09]. Se verifica la firma (MP_WEBHOOK_SECRET) y el estado del pago se
 * consulta directo en la API de Mercado Pago; el cuerpo del aviso no se usa para aplicar nada.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as { type?: string; action?: string; data?: { id?: string | number } } | null;
  const type = body?.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  const dataId = url.searchParams.get("data.id") ?? (body?.data?.id != null ? String(body.data.id) : null);
  if (type !== "payment" || !dataId || !/^\d{1,20}$/.test(dataId)) return new Response("ok");
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  if (!secret || !validMpSignature(secret, request.headers.get("x-signature"), request.headers.get("x-request-id"), dataId)) {
    return new Response("firma inválida", { status: 401 });
  }
  try {
    await syncMpPayment(prisma, dataId);
  } catch (e) {
    console.error("[mp] aviso:", e instanceof Error ? e.message : e);
    return new Response("reintentar", { status: 500 });
  }
  return new Response("ok");
}
