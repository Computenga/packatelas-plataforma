// CRM de prospectos: registro → contacto → alta → conecta ML → primer envío → activo.
// Las etapas comerciales (contactado, interesado, perdido) las mueve el equipo; de ALTA en
// adelante avanzan solas según lo que pasa en la plataforma (cuenta ML, envíos).
import { Prisma, type LeadSource, type LeadStage, type PrismaClient } from "../generated/prisma/client.ts";
import { enqueueNotification } from "./notifications.ts";
import { adminUserIds, sendPush } from "./push.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export const LEAD_STAGES: { key: LeadStage; label: string; auto?: boolean }[] = [
  { key: "NUEVO", label: "Nuevo" },
  { key: "CONTACTADO", label: "Contactado" },
  { key: "INTERESADO", label: "Interesado" },
  { key: "ALTA", label: "Dado de alta", auto: true },
  { key: "ML_CONECTADO", label: "Conectó ML", auto: true },
  { key: "PRIMER_ENVIO", label: "Primer envío", auto: true },
  { key: "ACTIVO", label: "Activo", auto: true },
  { key: "PERDIDO", label: "Perdido" },
];
export const STAGE_LABEL = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s.label])) as Record<LeadStage, string>;
const ORDER = LEAD_STAGES.map((s) => s.key);
const rank = (s: LeadStage) => ORDER.indexOf(s);

export const LEAD_SOURCES: { key: LeadSource; label: string }[] = [
  { key: "REGISTRO_WEB", label: "Registro en la web" },
  { key: "PRERREGISTRO", label: "Prerregistro (formulario)" },
  { key: "WHATSAPP", label: "WhatsApp" },
  { key: "REFERIDO", label: "Recomendación" },
  { key: "REDES", label: "Redes / anuncios" },
  { key: "VISITA", label: "Visita / en persona" },
  { key: "MANUAL", label: "Otro" },
];
export const SOURCE_LABEL = Object.fromEntries(LEAD_SOURCES.map((s) => [s.key, s.label])) as Record<LeadSource, string>;

/** Envíos para considerar a un cliente "activo". */
export const ACTIVE_AFTER_ORDERS = 10;

export const phoneKey = (raw?: string | null) => {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

export type LeadInput = {
  businessName: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  zone?: string | null;
  monthlyVolume?: string | null;
  salesChannels?: string | null;
  notes?: string | null;
  source?: LeadSource;
  ownerId?: string | null;
  signupId?: string | null;
  clientId?: string | null;
};

export async function addLeadActivity(db: Db, leadId: string, type: string, text: string, userId?: string | null) {
  const contact = ["llamada", "whatsapp", "visita"].includes(type);
  await db.leadActivity.create({ data: { leadId, type, text: text.slice(0, 2000), userId: userId ?? null } });
  await db.lead.update({ where: { id: leadId }, data: contact ? { lastContactAt: new Date() } : { updatedAt: new Date() } });
}

/**
 * Crea el prospecto o, si ya existe uno abierto con el mismo teléfono o correo, le suma la
 * información y devuelve ese (así un mismo negocio no aparece dos veces).
 */
export async function createLead(db: Db, input: LeadInput, actorUserId?: string | null): Promise<{ id: string; created: boolean }> {
  const key = phoneKey(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  const or: Prisma.LeadWhereInput[] = [];
  if (key) or.push({ phoneKey: key });
  if (email) or.push({ email });
  const existing = or.length ? await db.lead.findFirst({ where: { OR: or, stage: { not: "PERDIDO" } }, orderBy: { createdAt: "desc" } }) : null;
  if (existing) {
    await db.lead.update({
      where: { id: existing.id },
      data: {
        signupId: existing.signupId ?? input.signupId ?? undefined,
        clientId: existing.clientId ?? input.clientId ?? undefined,
        email: existing.email ?? email,
        phone: existing.phone ?? input.phone ?? undefined,
        phoneKey: existing.phoneKey ?? key,
        zone: existing.zone ?? input.zone ?? undefined,
        monthlyVolume: input.monthlyVolume || existing.monthlyVolume,
        salesChannels: input.salesChannels || existing.salesChannels,
      },
    });
    await addLeadActivity(db, existing.id, "sistema", `Volvió a registrarse (${SOURCE_LABEL[input.source ?? "MANUAL"]}): ${input.businessName}`, actorUserId);
    return { id: existing.id, created: false };
  }
  const lead = await db.lead.create({
    data: {
      businessName: input.businessName.trim().slice(0, 160),
      contactName: input.contactName?.trim() || null,
      phone: input.phone?.trim() || null,
      phoneKey: key,
      email,
      zone: input.zone || null,
      monthlyVolume: input.monthlyVolume?.trim() || null,
      salesChannels: input.salesChannels?.trim() || null,
      notes: input.notes?.trim() || null,
      source: input.source ?? "MANUAL",
      ownerId: input.ownerId || null,
      signupId: input.signupId || null,
      clientId: input.clientId || null,
      stage: input.clientId ? "ALTA" : "NUEVO",
      nextAction: input.clientId ? null : "Primer contacto",
      nextActionAt: input.clientId ? null : new Date(),
    },
  });
  await db.leadActivity.create({ data: { leadId: lead.id, type: "sistema", text: `Prospecto creado · ${SOURCE_LABEL[lead.source]}`, userId: actorUserId ?? null } });
  return { id: lead.id, created: true };
}

/** Prospecto desde el formulario de registro, con aviso a los administradores y bienvenida por WhatsApp. */
export async function leadFromSignup(prisma: PrismaClient, signupId: string) {
  const s = await prisma.clientSignup.findUnique({ where: { id: signupId } });
  if (!s) return null;
  const r = await createLead(prisma, {
    businessName: s.businessName, contactName: s.contactName, phone: s.phone, email: s.email, zone: s.zone,
    monthlyVolume: s.monthlyVolume, salesChannels: s.salesChannels, source: "REGISTRO_WEB", signupId: s.id,
  });
  await enqueueNotification(prisma, {
    event: "bienvenida_registro", to: s.phone, params: [s.contactName.split(/\s+/)[0] || s.contactName, s.businessName],
    dedupeKey: `bienvenida_registro:${s.id}`,
  }).catch(() => false);
  await sendPush(prisma, await adminUserIds(prisma), {
    title: "Nuevo registro de cliente",
    body: `${s.businessName} (${s.contactName}) · ${s.monthlyVolume ?? "volumen sin dato"} · ${s.zone === "emx" ? "Edomex" : "CDMX"}`,
    url: `/admin/crm/${r.id}`,
    tag: `lead-${r.id}`,
  });
  return r;
}

/** Al aprobar la solicitud: el prospecto pasa a "Dado de alta" ligado a su cliente. */
export async function leadSignupApproved(db: Db, signupId: string, clientId: string, actorUserId?: string | null) {
  const lead = await db.lead.findUnique({ where: { signupId } });
  if (!lead) return;
  await db.lead.update({ where: { id: lead.id }, data: { clientId, ...(rank(lead.stage) < rank("ALTA") || lead.stage === "PERDIDO" ? { stage: "ALTA", stageAt: new Date(), nextAction: "Que conecte su cuenta de MercadoLibre", nextActionAt: new Date() } : {}) } });
  await addLeadActivity(db, lead.id, "etapa", "Solicitud aprobada: ya es cliente", actorUserId);
}

export async function setLeadStage(db: Db, leadId: string, stage: LeadStage, actorUserId?: string | null, opts: { lostReason?: string } = {}) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { stage: true } });
  if (!lead || lead.stage === stage) return false;
  if (stage === "PERDIDO" && !opts.lostReason?.trim()) throw new Error("Escribe por qué se perdió");
  await db.lead.update({
    where: { id: leadId },
    data: { stage, stageAt: new Date(), lostReason: stage === "PERDIDO" ? opts.lostReason!.trim().slice(0, 300) : null, ...(stage === "PERDIDO" ? { nextAction: null, nextActionAt: null } : {}) },
  });
  await addLeadActivity(db, leadId, "etapa", `${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[stage]}${stage === "PERDIDO" ? ` · ${opts.lostReason!.trim()}` : ""}`, actorUserId);
  return true;
}

/** Liga el prospecto a un cliente existente (lo encuentra por teléfono, correo o ID). */
export async function linkLeadClient(db: Db, leadId: string, clientId: string, actorUserId?: string | null) {
  const [lead, client, taken] = await Promise.all([
    db.lead.findUnique({ where: { id: leadId }, select: { stage: true } }),
    db.client.findUnique({ where: { id: clientId }, select: { name: true, publicId: true } }),
    db.lead.findUnique({ where: { clientId }, select: { id: true, businessName: true } }),
  ]);
  if (!lead || !client) return { ok: false as const, error: "No se encontró" };
  if (taken && taken.id !== leadId) return { ok: false as const, error: `Ese cliente ya está ligado al prospecto ${taken.businessName}` };
  await db.lead.update({ where: { id: leadId }, data: { clientId, ...(rank(lead.stage) < rank("ALTA") || lead.stage === "PERDIDO" ? { stage: "ALTA", stageAt: new Date() } : {}) } });
  await addLeadActivity(db, leadId, "etapa", `Ligado al cliente ${client.publicId} · ${client.name}`, actorUserId);
  return { ok: true as const };
}

/** Clientes que parecen ser este prospecto (mismo teléfono o correo). */
export async function clientMatchesForLead(db: Db, leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { phoneKey: true, email: true, clientId: true } });
  if (!lead || lead.clientId) return [];
  const or: Prisma.ClientWhereInput[] = [];
  if (lead.email) or.push({ email: { equals: lead.email, mode: "insensitive" } });
  if (lead.phoneKey) or.push({ phone: { contains: lead.phoneKey } });
  if (!or.length) return [];
  return db.client.findMany({ where: { OR: or }, select: { id: true, name: true, publicId: true }, take: 5 });
}

/**
 * Avanza solo a los prospectos ya clientes: conectó ML → primer envío → activo
 * (nunca retrocede). Devuelve cuántos cambiaron.
 */
export async function advanceLeads(prisma: PrismaClient) {
  const leads = await prisma.lead.findMany({
    where: { clientId: { not: null }, stage: { in: ["ALTA", "ML_CONECTADO", "PRIMER_ENVIO"] } },
    select: { id: true, stage: true, clientId: true },
  });
  let moved = 0;
  for (const l of leads) {
    const [ml, orders] = await Promise.all([
      prisma.mlAccount.count({ where: { clientId: l.clientId!, status: "ACTIVE", accessTokenEnc: { not: null } } }),
      prisma.order.count({ where: { clientId: l.clientId!, kind: "DELIVERY", source: { not: "IMPORT" } } }),
    ]);
    const target: LeadStage = orders >= ACTIVE_AFTER_ORDERS ? "ACTIVO" : orders >= 1 ? "PRIMER_ENVIO" : ml > 0 ? "ML_CONECTADO" : "ALTA";
    if (rank(target) <= rank(l.stage)) continue;
    const next = target === "ACTIVO" ? null : target === "PRIMER_ENVIO" ? "Revisar que su primera semana vaya bien" : target === "ML_CONECTADO" ? "Acompañar su primer envío" : null;
    await prisma.lead.update({ where: { id: l.id }, data: { stage: target, stageAt: new Date(), nextAction: next, nextActionAt: next ? new Date() : null } });
    await prisma.leadActivity.create({ data: { leadId: l.id, type: "sistema", text: `${STAGE_LABEL[l.stage]} → ${STAGE_LABEL[target]} (automático: ${orders} envío(s), ${ml} cuenta(s) ML conectada(s))` } });
    moved++;
  }
  return moved;
}

/** Una sola vez: las solicitudes de registro que ya existían también entran al CRM. */
export async function backfillLeadsFromSignups(prisma: PrismaClient) {
  const signups = await prisma.clientSignup.findMany({ where: { NOT: { id: { in: (await prisma.lead.findMany({ where: { signupId: { not: null } }, select: { signupId: true } })).map((l) => l.signupId!) } } } });
  let n = 0;
  for (const s of signups) {
    const r = await createLead(prisma, {
      businessName: s.businessName, contactName: s.contactName, phone: s.phone, email: s.email, zone: s.zone,
      monthlyVolume: s.monthlyVolume, salesChannels: s.salesChannels, source: "REGISTRO_WEB", signupId: s.id,
      clientId: s.status === "APPROVED" ? s.clientId : null,
    });
    if (s.status === "REJECTED") await setLeadStage(prisma, r.id, "PERDIDO", null, { lostReason: s.reviewNote || "Solicitud rechazada" }).catch(() => false);
    await prisma.lead.update({ where: { id: r.id }, data: { createdAt: s.createdAt } });
    n++;
  }
  return n;
}

/**
 * Clientes que se enfrían: enviaban con regularidad y llevan días sin mandar nada.
 * Mira los 60 días anteriores a la última semana y medio.
 */
export async function coolingClients(db: Db, now = new Date(), opts = { quietDays: 10, minOrders: 10 }) {
  const quietSince = new Date(now.getTime() - opts.quietDays * 86400_000);
  const from = new Date(quietSince.getTime() - 60 * 86400_000);
  return db.$queryRaw<{ id: string; name: string; publicId: string; phone: string | null; contactName: string | null; orders: number; lastOrderAt: Date }[]>`
    SELECT c.id, c.name, c."publicId", c.phone, c."contactName",
           COUNT(o.id) FILTER (WHERE o."createdAt" >= ${from} AND o."createdAt" < ${quietSince})::int AS orders,
           MAX(o."createdAt") AS "lastOrderAt"
    FROM "Client" c
    JOIN "Order" o ON o."clientId" = c.id AND o.kind = 'DELIVERY' AND o.source <> 'IMPORT'
    WHERE c.active = true
    GROUP BY c.id
    HAVING MAX(o."createdAt") < ${quietSince}
       AND COUNT(o.id) FILTER (WHERE o."createdAt" >= ${from} AND o."createdAt" < ${quietSince}) >= ${opts.minOrders}
    ORDER BY COUNT(o.id) FILTER (WHERE o."createdAt" >= ${from} AND o."createdAt" < ${quietSince}) DESC
    LIMIT 100`;
}

/** Aviso diario a cada responsable con sus seguimientos del día (y a los admins los sin dueño). */
export async function remindFollowUps(prisma: PrismaClient, now = new Date()) {
  const endOfDay = new Date(now.getTime() + 12 * 3600_000);
  const due = await prisma.lead.findMany({
    where: { stage: { notIn: ["PERDIDO", "ACTIVO"] }, nextActionAt: { lte: endOfDay } },
    select: { id: true, ownerId: true },
  });
  if (!due.length) return 0;
  const byOwner = new Map<string, number>();
  const admins = await adminUserIds(prisma);
  for (const l of due) {
    for (const uid of l.ownerId ? [l.ownerId] : admins) byOwner.set(uid, (byOwner.get(uid) ?? 0) + 1);
  }
  for (const [uid, n] of byOwner) {
    await sendPush(prisma, [uid], { title: "Seguimientos de hoy", body: `Tienes ${n} prospecto(s) por contactar hoy en el CRM.`, url: "/admin/crm?vista=hoy", tag: "crm-hoy" });
  }
  return due.length;
}

// ── Importar prerregistros (formulario de Google u hoja de cálculo) ──
export type LeadImportRow = {
  at?: string | null; // ISO
  businessName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  zone?: string | null;
  salesChannels?: string | null;
  notes?: string | null;
};
export type LeadImportSummary = { created: number; linked: number; lost: number; repeated: number; alreadyClients: number; skipped: number };
export const LEAD_IMPORT_MAX = 3000;

/**
 * Reglas: lo que ya es cliente desde hace más de 60 días no entra (ya no es prospecto); lo que es
 * cliente reciente entra ligado y avanza solo; lo demás entra como prospecto, y si el registro tiene
 * más de `recentDays` días entra como «Perdido» (se puede reactivar) para no llenar el embudo de viejos.
 */
export async function importLeads(prisma: PrismaClient, rows: LeadImportRow[], actorUserId?: string | null, opts = { recentDays: 30, now: new Date() }): Promise<LeadImportSummary> {
  const sum: LeadImportSummary = { created: 0, linked: 0, lost: 0, repeated: 0, alreadyClients: 0, skipped: 0 };
  const clients = await prisma.client.findMany({ select: { id: true, phone: true, email: true, createdAt: true } });
  const byPhone = new Map<string, (typeof clients)[number]>();
  const byEmail = new Map<string, (typeof clients)[number]>();
  for (const c of clients) {
    const k = phoneKey(c.phone);
    if (k) byPhone.set(k, c);
    if (c.email) byEmail.set(c.email.trim().toLowerCase(), c);
  }
  const linkedClients = new Set((await prisma.lead.findMany({ where: { clientId: { not: null } }, select: { clientId: true } })).map((l) => l.clientId!));
  const recentFrom = opts.now.getTime() - opts.recentDays * 86400_000;
  const clientRecentFrom = opts.now.getTime() - 60 * 86400_000;

  for (const r of rows.slice(0, LEAD_IMPORT_MAX)) {
    const key = phoneKey(r.phone);
    const email = r.email?.trim().toLowerCase() || null;
    const name = (r.businessName || r.contactName || "").trim();
    if ((!key && !email) || !name) {
      sum.skipped++;
      continue;
    }
    const at = r.at && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at) : opts.now;
    const client = (key && byPhone.get(key)) || (email && byEmail.get(email)) || null;
    if (client && (client.createdAt.getTime() < clientRecentFrom || linkedClients.has(client.id))) {
      sum.alreadyClients++;
      continue;
    }
    const res = await createLead(prisma, {
      businessName: name, contactName: r.contactName, phone: r.phone, email, zone: r.zone, salesChannels: r.salesChannels,
      notes: r.notes, source: "PRERREGISTRO", clientId: client?.id ?? null,
    }, actorUserId);
    if (!res.created) {
      sum.repeated++;
      continue;
    }
    await prisma.lead.update({ where: { id: res.id }, data: { createdAt: at, stageAt: at } });
    if (client) {
      linkedClients.add(client.id);
      sum.linked++;
    } else if (at.getTime() < recentFrom) {
      await setLeadStage(prisma, res.id, "PERDIDO", actorUserId, { lostReason: "Prerregistro anterior sin alta (importado)" });
      sum.lost++;
    } else sum.created++;
  }
  return sum;
}
