import { prisma, savePushSubscription, vapidKeys } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

/** Llave pública VAPID para suscribirse. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
  return Response.json({ publicKey: (await vapidKeys(prisma)).publicKey });
}

/** Guarda la suscripción push de este dispositivo. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth) return Response.json({ error: "Suscripción inválida" }, { status: 400 });
  try {
    await savePushSubscription(prisma, user.id, { endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } }, request.headers.get("user-agent"));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status: 400 });
  }
}
