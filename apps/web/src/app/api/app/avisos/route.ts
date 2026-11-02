import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { APK_PATH, APP_RELEASE, appVersionFromUa, olderThanLatest } from "@/lib/app-release";

const SEEN_EVERY_MS = 3600_000;

/**
 * Avisos para la app Android [P03]: los nuevos desde ?despues=<ISO> (máx. 20) y si el
 * repartidor sigue en turno, para que la app apague el GPS al terminar el turno.
 * También registra qué versión de la app usa cada quien y, si es vieja, le deja un aviso
 * (una sola vez por versión) para que instale la nueva.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
  const raw = new URL(request.url).searchParams.get("despues");
  const after = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : new Date(Date.now() - 10 * 60_000);

  const version = appVersionFromUa(request.headers.get("user-agent"));
  if (version) {
    // Solo escribe si cambió la versión o pasó una hora: la app consulta cada minuto.
    await prisma.user.updateMany({
      where: { id: user.id, OR: [{ appVersion: { not: version } }, { appVersion: null }, { appSeenAt: null }, { appSeenAt: { lt: new Date(Date.now() - SEEN_EVERY_MS) } }] },
      data: { appVersion: version, appSeenAt: new Date() },
    });
    if (olderThanLatest(version)) {
      const title = `Actualiza la app a la versión ${APP_RELEASE.versionName}`;
      const sent = await prisma.appNotice.findFirst({ where: { userId: user.id, title }, select: { id: true } });
      if (!sent) {
        await prisma.appNotice.create({
          data: { userId: user.id, title, body: `Toca aquí y luego «Descargar app». ${APP_RELEASE.notes}`, url: "/descargar" },
        });
      }
    }
  }

  const [avisos, driver] = await Promise.all([
    prisma.appNotice.findMany({ where: { userId: user.id, createdAt: { gt: after } }, orderBy: { createdAt: "asc" }, take: 20 }),
    user.role === "REPARTIDOR" ? prisma.driver.findUnique({ where: { userId: user.id }, select: { onDuty: true } }) : null,
  ]);
  return Response.json(
    {
      rol: user.role,
      enTurno: driver?.onDuty ?? false,
      app: { versionCode: APP_RELEASE.versionCode, versionName: APP_RELEASE.versionName, url: APK_PATH },
      avisos: avisos.map((a) => ({ id: a.id, titulo: a.title, texto: a.body, url: a.url, fecha: a.createdAt.toISOString() })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
