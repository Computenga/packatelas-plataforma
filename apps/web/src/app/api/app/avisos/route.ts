import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

/**
 * Avisos para la app Android [P03]: los nuevos desde ?despues=<ISO> (máx. 20) y si el
 * repartidor sigue en turno, para que la app apague el GPS al terminar el turno.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
  const raw = new URL(request.url).searchParams.get("despues");
  const after = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : new Date(Date.now() - 10 * 60_000);
  const [avisos, driver] = await Promise.all([
    prisma.appNotice.findMany({ where: { userId: user.id, createdAt: { gt: after } }, orderBy: { createdAt: "asc" }, take: 20 }),
    user.role === "REPARTIDOR" ? prisma.driver.findUnique({ where: { userId: user.id }, select: { onDuty: true } }) : null,
  ]);
  return Response.json({
    rol: user.role,
    enTurno: driver?.onDuty ?? false,
    avisos: avisos.map((a) => ({ id: a.id, titulo: a.title, texto: a.body, url: a.url, fecha: a.createdAt.toISOString() })),
  }, { headers: { "Cache-Control": "no-store" } });
}
