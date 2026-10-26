import { enqueueMlJob, prisma } from "@packatelas/db";

/**
 * Notificaciones de MercadoLibre [A12]. Hay que responder rápido (si no, ML reintenta):
 * solo se encolan y el worker las procesa.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { resource?: string; topic?: string; user_id?: number; application_id?: number } | null;
  if (!body?.resource || !body.topic) return new Response("ok");
  const app = process.env.ML_CLIENT_ID?.trim();
  if (app && body.application_id != null && String(body.application_id) !== app) return new Response("ok");
  if (body.topic === "shipments" || body.topic === "shipments_v2") {
    const known = body.user_id ? await prisma.mlAccount.findUnique({ where: { mlUserId: BigInt(body.user_id) }, select: { id: true } }) : null;
    if (known) await enqueueMlJob(prisma, { topic: "shipments", resource: body.resource, mlUserId: BigInt(body.user_id!) }).catch(() => {});
  }
  return new Response("ok");
}
