// Limpieza diaria para que la base y el disco no crezcan sin control. Nunca borra lo que
// tiene valor de negocio (envíos, eventos, evidencias, cobros, checadas, nómina).
import type { PrismaClient } from "../generated/prisma/client.ts";

const days = (n: number, now: Date) => new Date(now.getTime() - n * 86400_000);

export async function dailyCleanup(prisma: PrismaClient, now = new Date()) {
  const [pings, sessions, quotas, webhooks, mlJobs, notices] = await Promise.all([
    // Ubicaciones del repartidor: el mapa en vivo usa la última; el historial sirve 60 días.
    prisma.locationPing.deleteMany({ where: { recordedAt: { lt: days(60, now) } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    // Contadores de intentos y cupos: solo importan unos días.
    prisma.setting.deleteMany({ where: { key: { startsWith: "quota:" }, updatedAt: { lt: days(3, now) }, NOT: { key: { startsWith: "quota:alta-uploads:" } } } }),
    prisma.webhookDelivery.deleteMany({ where: { status: "SENT", createdAt: { lt: days(30, now) } } }),
    prisma.mlJob.deleteMany({ where: { status: "DONE", updatedAt: { lt: days(14, now) } } }),
    prisma.appNotice.deleteMany({ where: { createdAt: { lt: days(7, now) } } }),
  ]);
  return { ubicaciones: pings.count, sesiones: sessions.count, contadores: quotas.count, webhooks: webhooks.count, tareasML: mlJobs.count, avisos: notices.count };
}
