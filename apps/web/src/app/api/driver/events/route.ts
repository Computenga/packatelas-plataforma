import { z } from "zod";
import { applyDriverEvent, FAIL_REASONS, notifyOrderStatus, prisma } from "@packatelas/db";
import { trackingPath } from "@/lib/tracking";
import { getDriverSession, unauthorized } from "@/lib/driver-api";

const eventSchema = z.object({
  clientEventId: z.string().min(8).max(64),
  orderId: z.string().min(1).max(40),
  type: z.enum(["loaded", "delivered", "failed"]),
  occurredAt: z.coerce.date(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  receiverName: z.string().trim().max(120).optional(),
  reason: z.enum(Object.keys(FAIL_REASONS) as [keyof typeof FAIL_REASONS]).optional(),
  note: z.string().trim().max(500).optional(),
  photoKey: z.string().regex(/^evidence\/[\w/.-]+$/).max(120).optional(),
});

/**
 * Recibe acciones del repartidor (en lote, desde la cola sin conexión).
 * Responde por evento; un reintento del mismo clientEventId no se aplica dos veces.
 */
export async function POST(request: Request) {
  const s = await getDriverSession();
  if (!s) return unauthorized();
  const body = (await request.json().catch(() => null)) as { events?: unknown[] } | null;
  const events = Array.isArray(body?.events) ? body.events.slice(0, 100) : [];

  const results = [];
  for (const raw of events) {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ clientEventId: (raw as { clientEventId?: string })?.clientEventId, ok: false, error: "Datos inválidos", permanent: true });
      continue;
    }
    const r = await applyDriverEvent(prisma, { ...parsed.data, driverId: s.driver.id, actorUserId: s.user.id });
    results.push({ clientEventId: parsed.data.clientEventId, ...r, permanent: !r.ok });
    if (r.ok && !r.duplicate) {
      // Aviso al comprador (en camino / entregado / no entregado); nunca bloquea la respuesta.
      const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || new URL(request.url).origin;
      await notifyOrderStatus(prisma, parsed.data.orderId, { trackingUrl: `${base}${trackingPath(parsed.data.orderId)}` }).catch((e) =>
        console.error("[avisos]", e instanceof Error ? e.message : e),
      );
    }
  }
  return Response.json({ results });
}
