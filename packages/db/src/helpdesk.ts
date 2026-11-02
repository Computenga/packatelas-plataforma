// Ayuda y soporte para tiendas [A35]: la tienda abre un reporte desde su portal, el equipo lo atiende
// y la conversación queda en un solo lugar con folio, estado y responsable. Avisos por push en ambos sentidos.
import type { Prisma, PrismaClient, TicketStatus } from "../generated/prisma/client.ts";
import { adminUserIds, sendPush } from "./push.ts";
import { notifyClient } from "./client-push.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export const TICKET_CATEGORIES = [
  { key: "envio", label: "Un envío (retraso, no entregado, dirección)" },
  { key: "dano", label: "Paquete dañado o perdido" },
  { key: "recoleccion", label: "Recolección" },
  { key: "pagos", label: "Pagos y saldo" },
  { key: "factura", label: "Facturación" },
  { key: "mercadolibre", label: "Conexión con Mercado Libre" },
  { key: "portal", label: "Uso del portal o accesos" },
  { key: "otro", label: "Otro tema" },
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]["key"];
export const CATEGORY_LABEL = Object.fromEntries(TICKET_CATEGORIES.map((c) => [c.key, c.label])) as Record<string, string>;

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Nuevo",
  IN_PROGRESS: "En atención",
  WAITING_CLIENT: "Esperando tu respuesta",
  RESOLVED: "Resuelto",
};
/** Cómo lo ve el equipo (el cliente ve TICKET_STATUS_LABEL). */
export const TICKET_STATUS_STAFF: Record<TicketStatus, string> = {
  OPEN: "Nuevo",
  IN_PROGRESS: "En atención",
  WAITING_CLIENT: "Esperando a la tienda",
  RESOLVED: "Resuelto",
};

export const folio = (n: number) => `S-${String(n).padStart(5, "0")}`;
const clean = (s: string, max: number) => s.replace(/\s+\n/g, "\n").trim().slice(0, max);

/** Busca el envío por código o número de ML dentro de los pedidos de esa tienda. */
async function findClientOrder(db: Db, clientId: string, ref: string | null | undefined) {
  const r = (ref ?? "").trim();
  if (!r) return null;
  const digits = /^\d{8,}$/.test(r) ? BigInt(r) : null;
  return db.order.findFirst({
    where: { clientId, OR: [{ code: { equals: r, mode: "insensitive" } }, { code: { equals: `ML-${r}`, mode: "insensitive" } }, ...(digits ? [{ mlShipmentId: digits }] : [])] },
    select: { id: true, code: true },
  });
}

async function staffToNotify(db: Db, t: { assignedToId: string | null }) {
  return t.assignedToId ? [t.assignedToId] : adminUserIds(db);
}

export async function createTicket(
  prisma: PrismaClient,
  input: { clientId: string; userId: string; category: string; subject: string; text: string; orderRef?: string | null; attachmentKey?: string | null },
) {
  if (!TICKET_CATEGORIES.some((c) => c.key === input.category)) throw new Error("Elige de qué se trata");
  const subject = clean(input.subject, 120);
  const text = clean(input.text, 4000);
  if (subject.length < 4) throw new Error("Escribe un título corto (qué pasa)");
  if (text.length < 10) throw new Error("Cuéntanos con un poco más de detalle");
  let orderId: string | null = null;
  if (input.orderRef?.trim()) {
    const o = await findClientOrder(prisma, input.clientId, input.orderRef);
    if (!o) throw new Error("No encontramos ese envío en tu cuenta. Revisa el número o déjalo vacío.");
    orderId = o.id;
  }
  const t = await prisma.ticket.create({
    data: {
      clientId: input.clientId,
      createdById: input.userId,
      category: input.category,
      subject,
      orderId,
      clientSeenAt: new Date(),
      messages: { create: { authorId: input.userId, fromStaff: false, text, attachmentKey: input.attachmentKey ?? null } },
    },
    include: { client: { select: { name: true, publicId: true } } },
  });
  await sendPush(prisma, await adminUserIds(prisma), {
    title: `Soporte ${folio(t.number)} · ${t.client.name}`,
    body: `${CATEGORY_LABEL[t.category] ?? t.category}: ${subject}`,
    url: `/admin/soporte/${t.id}`,
    tag: `ticket-${t.id}`,
  }).catch(() => {});
  return t;
}

/** La tienda escribe en su reporte (si estaba resuelto, se reabre). */
export async function clientReply(prisma: PrismaClient, input: { ticketId: string; clientId: string; userId: string; text: string; attachmentKey?: string | null }) {
  const t = await prisma.ticket.findFirst({ where: { id: input.ticketId, clientId: input.clientId }, include: { client: { select: { name: true } } } });
  if (!t) throw new Error("Reporte no encontrado");
  const text = clean(input.text, 4000);
  if (!text && !input.attachmentKey) throw new Error("Escribe tu mensaje");
  const now = new Date();
  await prisma.$transaction([
    prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: input.userId, fromStaff: false, text: text || "(foto)", attachmentKey: input.attachmentKey ?? null } }),
    prisma.ticket.update({
      where: { id: t.id },
      data: { lastMessageAt: now, clientSeenAt: now, status: t.status === "WAITING_CLIENT" || t.status === "RESOLVED" ? "IN_PROGRESS" : t.status, resolvedAt: null },
    }),
  ]);
  await sendPush(prisma, await staffToNotify(prisma, t), {
    title: `${t.client.name} respondió · ${folio(t.number)}`,
    body: text.slice(0, 120) || "Envió una foto",
    url: `/admin/soporte/${t.id}`,
    tag: `ticket-${t.id}`,
  }).catch(() => {});
}

/** Respuesta del equipo. `internal` = nota que la tienda no ve. `next` = estado tras responder. */
export async function staffReply(
  prisma: PrismaClient,
  input: { ticketId: string; userId: string; text: string; internal?: boolean; next?: TicketStatus; attachmentKey?: string | null },
) {
  const t = await prisma.ticket.findUnique({ where: { id: input.ticketId } });
  if (!t) throw new Error("Reporte no encontrado");
  const text = clean(input.text, 4000);
  if (!text && !input.attachmentKey) throw new Error("Escribe la respuesta");
  const now = new Date();
  const status: TicketStatus = input.internal ? (t.status === "OPEN" ? "IN_PROGRESS" : t.status) : (input.next ?? "WAITING_CLIENT");
  await prisma.$transaction([
    prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: input.userId, fromStaff: true, internal: !!input.internal, text: text || "(foto)", attachmentKey: input.attachmentKey ?? null } }),
    prisma.ticket.update({
      where: { id: t.id },
      data: {
        status,
        staffSeenAt: now,
        ...(input.internal ? {} : { lastMessageAt: now }),
        assignedToId: t.assignedToId ?? input.userId,
        resolvedAt: status === "RESOLVED" ? now : null,
      },
    }),
  ]);
  if (!input.internal) {
    await notifyClient(prisma, t.clientId, "soporte", {
      title: status === "RESOLVED" ? `Resolvimos tu reporte ${folio(t.number)}` : `Te respondimos · ${folio(t.number)}`,
      body: text.slice(0, 140) || "Te enviamos una foto",
      url: `/cliente/soporte/${t.id}`,
      tag: `ticket-${t.id}`,
    }).catch(() => 0);
  }
}

export async function setTicketStatus(prisma: PrismaClient, ticketId: string, status: TicketStatus, actorUserId: string) {
  const t = await prisma.ticket.update({ where: { id: ticketId }, data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null } });
  await audit(prisma, { actorUserId, action: "ticket.status", entity: "Ticket", entityId: t.id, summary: `${folio(t.number)} → ${TICKET_STATUS_STAFF[status]}` });
  if (status === "RESOLVED") {
    await notifyClient(prisma, t.clientId, "soporte", { title: `Resolvimos tu reporte ${folio(t.number)}`, body: t.subject, url: `/cliente/soporte/${t.id}`, tag: `ticket-${t.id}` }).catch(() => 0);
  }
  return t;
}

/** La tienda da por resuelto su reporte. */
export async function clientResolve(prisma: PrismaClient, ticketId: string, clientId: string) {
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, clientId } });
  if (!t) throw new Error("Reporte no encontrado");
  await prisma.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
}

export async function assignTicket(prisma: PrismaClient, ticketId: string, userId: string | null, actorUserId: string) {
  const t = await prisma.ticket.update({ where: { id: ticketId }, data: { assignedToId: userId } });
  if (userId && userId !== actorUserId) {
    await sendPush(prisma, [userId], { title: `Te asignaron ${folio(t.number)}`, body: t.subject, url: `/admin/soporte/${t.id}`, tag: `ticket-${t.id}` }).catch(() => {});
  }
  return t;
}
