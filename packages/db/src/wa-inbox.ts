// Bandeja de WhatsApp en el portal: lo que la gente escribe al número de avisos se guarda aquí y
// se responde desde el portal. WhatsApp solo permite texto libre durante las 24 h siguientes al
// último mensaje de la persona; fuera de esa ventana solo se pueden mandar plantillas aprobadas.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { phoneKey } from "./crm.ts";
import { adminUserIds, sendPush } from "./push.ts";

type Db = PrismaClient | Prisma.TransactionClient;
export const WINDOW_MS = 24 * 3600_000;

/** 5215512345678 / 525512345678 / 5512345678 → 525512345678 */
export const waKey = (raw: string) => {
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? `52${d.slice(-10)}` : d;
};

type Inbound = {
  id?: string; from?: string; timestamp?: string; type?: string;
  text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { id?: string; mime_type?: string; caption?: string }; audio?: { id?: string; mime_type?: string }; video?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string }; sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
};

/** Texto legible de un mensaje entrante (lo que se muestra y lo que se interpreta). */
export function inboundText(m: Inbound) {
  return m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
    ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? m.document?.filename
    ?? (m.location ? [m.location.name, m.location.address, m.location.latitude != null ? `${m.location.latitude},${m.location.longitude}` : null].filter(Boolean).join(" · ") : null) ?? null;
}

/** Guarda un mensaje entrante (idempotente por id de WhatsApp). Devuelve si es nuevo. */
export async function recordInbound(prisma: PrismaClient, m: Inbound, contactName?: string | null) {
  if (!m.from) return false;
  const media = m.image ?? m.audio ?? m.video ?? m.document ?? m.sticker;
  const kind = m.type === "button" || m.type === "interactive" ? "button" : (m.type ?? "other");
  try {
    await prisma.waMessage.create({
      data: {
        phone: waKey(m.from), direction: "in", kind, text: inboundText(m)?.slice(0, 4000) ?? null, mediaId: media?.id ?? null, mime: media?.mime_type ?? null,
        waId: m.id ?? null, contactName: contactName?.slice(0, 120) ?? null,
        createdAt: m.timestamp && /^\d+$/.test(m.timestamp) ? new Date(Number(m.timestamp) * 1000) : new Date(),
      },
    });
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false; // WhatsApp reintentó el aviso
    throw e;
  }
}

export async function recordOutbound(db: Db, o: { phone: string; kind: "text" | "template"; text: string; waId?: string | null; userId?: string | null; status?: string; error?: string | null }) {
  return db.waMessage.create({
    data: { phone: waKey(o.phone), direction: "out", kind: o.kind, text: o.text.slice(0, 4000), waId: o.waId ?? null, userId: o.userId ?? null, status: o.status ?? (o.waId ? "sent" : "failed"), error: o.error ?? null },
  }).catch((e) => ((e as { code?: string }).code === "P2002" ? null : Promise.reject(e)));
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
/** Estado de un mensaje saliente (lo manda WhatsApp por webhook). */
export async function applyWaMessageStatus(prisma: PrismaClient, waId: string, status: string, error?: string) {
  const row = await prisma.waMessage.findUnique({ where: { waId }, select: { id: true, status: true } });
  if (!row) return false;
  if (status === "failed") await prisma.waMessage.update({ where: { id: row.id }, data: { status, error: error?.slice(0, 300) ?? null } });
  else if ((RANK[status] ?? 0) > (RANK[row.status ?? ""] ?? 0)) await prisma.waMessage.update({ where: { id: row.id }, data: { status } });
  return true;
}

/** Hasta cuándo se puede responder con texto libre (24 h desde el último mensaje de la persona). */
export async function replyWindow(db: Db, phone: string, now = new Date()) {
  const last = await db.waMessage.findFirst({ where: { phone: waKey(phone), direction: "in" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const until = last ? new Date(last.createdAt.getTime() + WINDOW_MS) : null;
  return { open: !!until && until > now, until };
}

/** ¿Quién es? Prospecto del CRM, tienda (cliente) o desconocido. */
export async function whoIs(db: Db, phone: string) {
  const key = phoneKey(phone);
  if (!key) return {};
  const [lead, client] = await Promise.all([
    db.lead.findFirst({ where: { phoneKey: key }, orderBy: { createdAt: "desc" }, select: { id: true, businessName: true, stage: true } }),
    db.client.findFirst({ where: { OR: [{ phone: { contains: key } }, { branches: { some: { phone: { contains: key } } } }] }, select: { id: true, name: true, publicId: true } }),
  ]);
  return { lead, client };
}

export type Conversation = { phone: string; name: string | null; last: { text: string | null; kind: string; direction: string; at: Date }; unread: number; windowOpen: boolean };

/** Conversaciones ordenadas por el último mensaje (las que tienen al menos un mensaje entrante). */
export async function listConversations(prisma: PrismaClient, opts: { q?: string; limit?: number } = {}, now = new Date()): Promise<Conversation[]> {
  const rows = await prisma.$queryRaw<{ phone: string; at: Date; lastIn: Date | null; unread: bigint }[]>`
    SELECT phone, max("createdAt") AS at, max(CASE WHEN direction = 'in' THEN "createdAt" END) AS "lastIn",
           count(*) FILTER (WHERE direction = 'in' AND "readAt" IS NULL) AS unread
    FROM "WaMessage" GROUP BY phone HAVING count(*) FILTER (WHERE direction = 'in') > 0
    ORDER BY at DESC LIMIT ${opts.limit ?? 200}`;
  const phones = rows.map((r) => r.phone);
  const [lasts, names] = await Promise.all([
    prisma.waMessage.findMany({ where: { phone: { in: phones } }, orderBy: { createdAt: "desc" }, distinct: ["phone"], select: { phone: true, text: true, kind: true, direction: true, createdAt: true } }),
    prisma.waMessage.findMany({ where: { phone: { in: phones }, contactName: { not: null } }, orderBy: { createdAt: "desc" }, distinct: ["phone"], select: { phone: true, contactName: true } }),
  ]);
  const leads = await prisma.lead.findMany({ where: { phoneKey: { in: phones.map((p) => p.slice(-10)) } }, select: { phoneKey: true, businessName: true } });
  const out = rows.map((r) => {
    const l = lasts.find((x) => x.phone === r.phone)!;
    const name = leads.find((x) => x.phoneKey === r.phone.slice(-10))?.businessName ?? names.find((x) => x.phone === r.phone)?.contactName ?? null;
    return { phone: r.phone, name, last: { text: l.text, kind: l.kind, direction: l.direction, at: l.createdAt }, unread: Number(r.unread), windowOpen: !!r.lastIn && r.lastIn.getTime() + WINDOW_MS > now.getTime() };
  });
  const q = opts.q?.trim().toLowerCase();
  return q ? out.filter((c) => c.phone.includes(q.replace(/\D/g, "") || "~") || c.name?.toLowerCase().includes(q)) : out;
}

export async function conversation(prisma: PrismaClient, phone: string, markRead = true) {
  const key = waKey(phone);
  const messages = await prisma.waMessage.findMany({ where: { phone: key }, orderBy: { createdAt: "asc" }, take: 500 });
  if (markRead) await prisma.waMessage.updateMany({ where: { phone: key, direction: "in", readAt: null }, data: { readAt: new Date() } });
  const userIds = [...new Set(messages.map((m) => m.userId).filter((x): x is string => !!x))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  return messages.map((m) => ({ ...m, by: users.find((u) => u.id === m.userId)?.name ?? null }));
}

export const unreadWhatsapp = (db: Db) => db.waMessage.count({ where: { direction: "in", readAt: null } });

/**
 * Aviso a administración de un mensaje nuevo (uno por conversación cada 10 min, para no saturar).
 */
export async function notifyInbound(prisma: PrismaClient, phone: string, text: string | null, name?: string | null) {
  const key = waKey(phone);
  const recent = await prisma.waMessage.count({ where: { phone: key, direction: "in", createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
  if (recent > 1) return;
  const who = await whoIs(prisma, key);
  const label = who.lead?.businessName ?? who.client?.name ?? name ?? `…${key.slice(-4)}`;
  await sendPush(prisma, await adminUserIds(prisma), { title: `💬 WhatsApp de ${label}`, body: (text ?? "Mensaje").slice(0, 140), url: `/admin/whatsapp?tel=${key}`, tag: `wa-${key}` }).catch(() => null);
}
