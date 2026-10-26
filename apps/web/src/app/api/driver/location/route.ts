import { z } from "zod";
import { prisma, recordLocations } from "@packatelas/db";
import { getDriverSession, unauthorized } from "@/lib/driver-api";

const point = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nonnegative().optional(),
  speed: z.number().nullable().optional(),
  battery: z.number().min(0).max(1).optional(),
  at: z.coerce.date(),
});

/** Puntos de ubicación acumulados por el teléfono durante el turno [R10]. */
export async function POST(request: Request) {
  const s = await getDriverSession();
  if (!s) return unauthorized();
  const body = await request.json().catch(() => null);
  const parsed = z.object({ points: z.array(point).max(500) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
  const now = Date.now();
  const points = parsed.data.points
    .filter((p) => p.at.getTime() <= now + 60_000 && p.at.getTime() > now - 24 * 3600_000)
    .map((p) => ({ ...p, speed: p.speed ?? undefined }));
  const saved = await recordLocations(prisma, s.driver.id, points);
  return Response.json({ saved });
}
