// Notificaciones push (Web Push con VAPID) [P05]. Las llaves VAPID se crean solas la primera vez y se
// guardan en la base (la privada cifrada con ENCRYPTION_KEY): no hay que configurar nada.
import webpush from "web-push";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";

type Db = PrismaClient | Prisma.TransactionClient;
const KEY = "push.vapid";
let cached: { publicKey: string; privateKey: string } | null = null;

export async function vapidKeys(db: Db) {
  if (cached) return cached;
  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (row) {
    const v = row.value as { publicKey: string; privateEnc: string };
    try {
      cached = { publicKey: v.publicKey, privateKey: decryptSecret(v.privateEnc) };
      return cached;
    } catch {
      // ENCRYPTION_KEY cambió: se generan llaves nuevas y las suscripciones viejas ya no sirven.
      await db.setting.delete({ where: { key: KEY } }).catch(() => {});
      await db.pushSubscription.deleteMany({});
    }
  }
  const k = webpush.generateVAPIDKeys();
  try {
    await db.setting.create({ data: { key: KEY, value: { publicKey: k.publicKey, privateEnc: encryptSecret(k.privateKey) } } });
    cached = k;
  } catch {
    cached = null; // otro proceso la creó al mismo tiempo
    return vapidKeys(db);
  }
  return cached;
}

// Solo servicios de notificaciones de los navegadores (Chrome/Android, Firefox, Safari, Edge):
// así el servidor nunca hace peticiones a direcciones que elija quien se suscribe.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];
export function isPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

export async function savePushSubscription(db: Db, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string | null) {
  if (!isPushEndpoint(sub.endpoint) || sub.endpoint.length > 1000) throw new Error("Suscripción inválida");
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export type PushMessage = { title: string; body: string; url?: string; tag?: string };
type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: object) => Promise<unknown>;

/** Envía a todos los dispositivos de los usuarios. Nunca lanza: un aviso fallido no rompe la operación. */
export async function sendPush(prisma: PrismaClient, userIds: string[], msg: PushMessage, send: Sender = webpush.sendNotification) {
  if (!userIds.length) return { sent: 0, removed: 0 };
  // Copia para la app Android (la consulta cada minuto); se borran las de más de 7 días.
  await prisma.appNotice
    .createMany({ data: [...new Set(userIds)].map((userId) => ({ userId, title: msg.title.slice(0, 120), body: msg.body.slice(0, 500), url: msg.url ?? null })) })
    .then(() => prisma.appNotice.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86400_000) } } }))
    .catch((e) => console.error("[push] avisos de la app:", e instanceof Error ? e.message : e));
  try {
    const subs = (await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } })).filter((x) => isPushEndpoint(x.endpoint));
    if (!subs.length) return { sent: 0, removed: 0 };
    const keys = await vapidKeys(prisma);
    let sent = 0, removed = 0;
    const opts = { vapidDetails: { subject: "mailto:operacion@packatelas.mx", publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 86400 };
    await Promise.all(subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), opts);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); removed++; }
      }
    }));
    return { sent, removed };
  } catch (e) {
    console.error("[push]", e instanceof Error ? e.message : e);
    return { sent: 0, removed: 0 };
  }
}

/** Usuarios ADMIN activos (para avisos internos). */
export async function adminUserIds(db: Db) {
  return (await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } })).map((u) => u.id);
}
