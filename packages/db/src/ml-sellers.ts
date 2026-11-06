// Listados de vendedores que comparte MercadoLibre (seudónimo, dirección, teléfono, correo):
// se importan al CRM como prospectos y se les invita por WhatsApp a usar Flex con Packatelas.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { addLeadActivity, createLead, phoneKey, setLeadStage } from "./crm.ts";
import { canonicalMunicipio, municipioFromAddress } from "./municipios.ts";
import { isOptedOut, NOTIFY_EVENTS, renderPreview, setOptOut } from "./notifications.ts";
import { audit } from "./orders.ts";
import { adminUserIds, sendPush } from "./push.ts";

export type MxPhone = { phone: string; note: string | null };

/**
 * Teléfono de México a 10 dígitos. Acepta lada internacional (52, 521, +52 1), el 1 de celular,
 * prefijos viejos (01, 044, 045) y números locales de 8 dígitos (se les pone la lada 55 de la
 * Ciudad de México y Área Metropolitana). Devuelve null si no se puede identificar.
 */
export function mxPhone(raw: unknown): MxPhone | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d || /^0+$/.test(d)) return null;
  let note: string | null = null;
  // Prefijos de marcación (en el orden en que suelen aparecer).
  for (let i = 0; i < 3 && d.length > 10; i++) {
    if (d.length >= 12 && d.startsWith("52")) d = d.slice(2);
    else if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    else if (/^(044|045)/.test(d) && d.length === 13) d = d.slice(3);
    else if (/^(44|45)/.test(d) && d.length === 12) d = d.slice(2); // 044 sin el cero
    else if (d.startsWith("01") && d.length === 12) d = d.slice(2);
    else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
    else break;
  }
  if (d.length === 8) {
    d = `55${d}`;
    note = "se le agregó la lada 55 (venía con 8 dígitos; probablemente teléfono fijo)";
  }
  if (d.length !== 10 || /^[01]/.test(d)) return null;
  return { phone: d, note };
}

export type MlSellerRow = {
  sellerId?: string | null;
  nickname?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
};
export type MlSellerImportSummary = { created: number; withWhatsapp: number; alreadyClients: number; repeated: number; skipped: number; phoneFixed: number; phoneBad: number };
export const ML_SELLER_IMPORT_MAX = 5000;

const zoneOf = (state?: string | null) => {
  const s = (state ?? "").toUpperCase();
  return s.includes("DIF") || s.includes("CDMX") || s.includes("CIUDAD") ? "cmx" : s.includes("MEX") ? "emx" : null;
};

/**
 * Importa el listado. No entran los vendedores que ya son clientes (por cuenta ML, teléfono o
 * correo); los que ya estaban en el CRM solo se completan.
 */
export async function importMlSellers(prisma: PrismaClient, rows: MlSellerRow[], actorUserId?: string | null): Promise<MlSellerImportSummary> {
  const sum: MlSellerImportSummary = { created: 0, withWhatsapp: 0, alreadyClients: 0, repeated: 0, skipped: 0, phoneFixed: 0, phoneBad: 0 };
  const [accounts, clients] = await Promise.all([
    prisma.mlAccount.findMany({ select: { mlUserId: true } }),
    prisma.client.findMany({ select: { phone: true, email: true, branches: { select: { phone: true } }, users: { select: { email: true } } } }),
  ]);
  const sellers = new Set(accounts.map((a) => a.mlUserId.toString()));
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const c of clients) {
    for (const p of [c.phone, ...c.branches.map((b) => b.phone)]) {
      const k = phoneKey(p);
      if (k) phones.add(k);
    }
    for (const e of [c.email, ...c.users.map((u) => u.email)]) if (e) emails.add(e.trim().toLowerCase());
  }

  for (const r of rows.slice(0, ML_SELLER_IMPORT_MAX)) {
    const sellerId = String(r.sellerId ?? "").replace(/\D/g, "");
    const name = (r.nickname ?? "").trim();
    if (!name && !sellerId) { sum.skipped++; continue; }
    const p1 = mxPhone(r.phone1), p2 = mxPhone(r.phone2);
    const hadPhone = [r.phone1, r.phone2].some((x) => String(x ?? "").replace(/\D/g, "").replace(/^0+$/, ""));
    const best = p1 ?? p2;
    if (best?.note || (best && String(best === p1 ? r.phone1 : r.phone2).replace(/\D/g, "") !== best.phone)) sum.phoneFixed++;
    if (hadPhone && !best) sum.phoneBad++;
    const email = (r.email ?? "").trim().toLowerCase() || null;
    if ((sellerId && sellers.has(sellerId)) || (best && phones.has(best.phone)) || (email && emails.has(email))) { sum.alreadyClients++; continue; }
    if (!best && !email) { sum.skipped++; continue; }

    const prev = sellerId ? await prisma.lead.findUnique({ where: { mlSellerId: BigInt(sellerId) }, select: { id: true } }) : null;
    if (prev) { sum.repeated++; continue; }

    const muni = municipioFromAddress(r.address) ?? (r.city ? canonicalMunicipio(r.city) : null);
    const other = p1 && p2 && p2.phone !== p1.phone ? p2.phone : null;
    const notes = [
      sellerId && `Vendedor ML ${sellerId}`,
      other && `Otro teléfono: ${other}`,
      best?.note && `Teléfono: ${best.note}`,
      !best && hadPhone && "Teléfono del listado no válido",
    ].filter(Boolean).join(". ") || null;
    const res = await createLead(prisma, {
      businessName: name || `Vendedor ML ${sellerId}`, phone: best?.phone ?? null, email,
      zone: zoneOf(r.state) ?? muni?.zone ?? null, municipality: muni?.name ?? r.city ?? null, notes, source: "LISTA_ML",
    }, actorUserId);
    if (!res.created) {
      // Ya estaba en el CRM con el mismo teléfono o correo: se le liga el vendedor y la dirección.
      await prisma.lead.update({ where: { id: res.id }, data: { mlSellerId: sellerId ? BigInt(sellerId) : undefined, address: r.address?.trim().slice(0, 300) || undefined } }).catch(() => null);
      sum.repeated++;
      continue;
    }
    await prisma.lead.update({
      where: { id: res.id },
      data: { mlSellerId: sellerId ? BigInt(sellerId) : null, address: r.address?.trim().slice(0, 300) || null, nextAction: best ? "Invitación Flex por WhatsApp" : "Invitar por correo o llamada", nextActionAt: null },
    });
    sum.created++;
    if (best) sum.withWhatsapp++;
  }
  await audit(prisma, { actorUserId: actorUserId ?? undefined, action: "crm.import_ml_list", entity: "Lead", summary: `Listado de ML: ${sum.created} prospectos nuevos (${sum.withWhatsapp} con teléfono), ${sum.alreadyClients} ya clientes, ${sum.repeated} repetidos` });
  return sum;
}

// ── Campaña: invitación a usar Flex con Packatelas ──
const inviteKey = (leadId: string) => `flex_invite:${leadId}`;

export type FlexInviteTarget = { leadId: string; name: string; phone: string; zone: string | null; municipality: string | null; preview: string };

/** Prospectos del listado de ML que aún no reciben la invitación (con teléfono y sin baja). */
export async function flexInviteTargets(prisma: PrismaClient, opts: { zone?: string | null; limit?: number } = {}) {
  const leads = await prisma.lead.findMany({
    where: { source: "LISTA_ML", stage: "NUEVO", phone: { not: null }, ...(opts.zone ? { zone: opts.zone } : {}) },
    orderBy: [{ zone: "asc" }, { municipality: "asc" }, { businessName: "asc" }],
    select: { id: true, businessName: true, phone: true, zone: true, municipality: true },
  });
  const sent = new Set(
    (await prisma.notification.findMany({ where: { dedupeKey: { startsWith: "flex_invite:" } }, select: { dedupeKey: true } })).map((n) => n.dedupeKey),
  );
  const out: FlexInviteTarget[] = [];
  let optedOut = 0;
  const seenPhones = new Set<string>();
  for (const l of leads) {
    if (sent.has(inviteKey(l.id))) continue;
    const to = `52${l.phone!.replace(/\D/g, "").slice(-10)}`;
    if (seenPhones.has(to)) continue;
    if (await isOptedOut(prisma, to)) { optedOut++; continue; }
    seenPhones.add(to);
    out.push({ leadId: l.id, name: l.businessName, phone: to, zone: l.zone, municipality: l.municipality, preview: renderPreview("invitacion_flex", [l.businessName]) });
  }
  return { total: out.length, optedOut, targets: opts.limit ? out.slice(0, opts.limit) : out };
}

/** Encola el lote (un mensaje por prospecto, una sola vez en la vida). */
export async function sendFlexInvites(prisma: PrismaClient, actorUserId: string | null, opts: { zone?: string | null; limit: number }) {
  const { targets } = await flexInviteTargets(prisma, { zone: opts.zone, limit: Math.min(500, Math.max(1, opts.limit)) });
  let queued = 0;
  for (const t of targets) {
    const ok = await prisma.notification
      .create({ data: { event: "invitacion_flex", to: t.phone, template: NOTIFY_EVENTS.invitacion_flex.template, params: [t.name.slice(0, 60), t.leadId], preview: t.preview, dedupeKey: inviteKey(t.leadId) } })
      .then(() => true)
      .catch(() => false);
    if (!ok) continue;
    queued++;
    await addLeadActivity(prisma, t.leadId, "whatsapp", "Se envió la invitación a Flex por WhatsApp (campaña)", actorUserId);
    await prisma.lead.update({ where: { id: t.leadId }, data: { nextAction: "Esperar respuesta de la invitación Flex", nextActionAt: null } });
  }
  await audit(prisma, { actorUserId: actorUserId ?? undefined, action: "crm.flex_invite", entity: "Notification", summary: `Invitación Flex: ${queued} WhatsApp encolados${opts.zone ? ` (zona ${opts.zone})` : ""}` });
  return { queued };
}

/** Resultados de la campaña. */
export async function flexInviteStats(prisma: PrismaClient) {
  const [byStatus, replied, interested, lost] = await Promise.all([
    prisma.notification.groupBy({ by: ["status"], where: { dedupeKey: { startsWith: "flex_invite:" } }, _count: { _all: true } }),
    prisma.leadActivity.count({ where: { type: "whatsapp", text: { startsWith: "Respondió a la invitación" } } }),
    prisma.lead.count({ where: { source: "LISTA_ML", stage: { in: ["INTERESADO", "ALTA", "ML_CONECTADO", "PRIMER_ENVIO", "ACTIVO"] } } }),
    prisma.lead.count({ where: { source: "LISTA_ML", stage: "PERDIDO" } }),
  ]);
  const s = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) as Record<string, number>;
  return { sent: Object.values(s).reduce((a, b) => a + b, 0), status: s, replied, interested, lost };
}

/** Número oficial de contacto (lo atiende el equipo de altas). La invitación sale de otro número que no se atiende. */
export const OFFICIAL_WA = "525664275415";
export const officialWaLink = (seller?: string) =>
  `https://wa.me/${OFFICIAL_WA}?text=${encodeURIComponent(`Hola, me interesa Flex con Packatelas.${seller ? ` Mi cuenta de Mercado Libre: ${seller}` : ""}`)}`;

/**
 * El vendedor tocó «Escribir a Packatelas» en la invitación: se anota en el CRM y se devuelve el
 * enlace al chat del número oficial (con su cuenta de ML ya escrita).
 */
export async function flexInviteClick(prisma: PrismaClient, leadId: string) {
  const lead = /^[a-z0-9]{20,40}$/.test(leadId)
    ? await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, businessName: true, stage: true, source: true } })
    : null;
  if (!lead || lead.source !== "LISTA_ML") return officialWaLink();
  const recent = await prisma.leadActivity.findFirst({ where: { leadId: lead.id, text: { startsWith: "Tocó «Escribir a Packatelas»" }, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (!recent) {
    await addLeadActivity(prisma, lead.id, "whatsapp", "Tocó «Escribir a Packatelas» en la invitación (abrió el chat del WhatsApp oficial)");
    if (["NUEVO", "CONTACTADO"].includes(lead.stage)) await setLeadStage(prisma, lead.id, "INTERESADO").catch(() => false);
    await prisma.lead.update({ where: { id: lead.id }, data: { nextAction: "Confirmar que escribió al WhatsApp oficial y darlo de alta", nextActionAt: new Date() } });
    await sendPush(prisma, await adminUserIds(prisma), { title: `Invitación Flex: ${lead.businessName} quiere escribir`, body: "Abrió el chat del WhatsApp oficial (56 6427 5415).", url: `/admin/crm/${lead.id}`, tag: `flex-${lead.id}` }).catch(() => null);
  }
  return officialWaLink(lead.businessName);
}

/** Acuse automático: la conversación sigue en este mismo número y la atiende el equipo desde el portal. */
export function flexInviteAutoReply(kind: "si" | "no" | "otro") {
  if (kind === "no") return "Gracias por avisarnos. No te volveremos a escribir por este medio.";
  return "¡Gracias por responder! En un momento alguien del equipo de Packatelas te atiende por aquí mismo para darte de alta y compartirte tarifas.";
}

const NO = /^(NO ME INTERESA|NO GRACIAS|NO,? GRACIAS|NO|BAJA|STOP|ALTO)\b/;
const YES = /^(ME INTERESA|SI|SÍ|CLARO|INFO|INFORMES|TARIFAS|COTIZA)/;

/**
 * Respuesta por WhatsApp de alguien a quien se invitó: «Me interesa» → Interesado; «No me
 * interesa» o BAJA → Perdido y no se le vuelve a escribir; cualquier otra cosa → Contactado. Avisa
 * a los administradores para darle seguimiento.
 */
export async function handleFlexInviteReply(prisma: PrismaClient, from: string, text: string): Promise<false | "si" | "no" | "otro"> {
  const key = phoneKey(from);
  if (!key) return false;
  const lead = await prisma.lead.findFirst({ where: { phoneKey: key, source: "LISTA_ML" }, orderBy: { createdAt: "desc" }, select: { id: true, businessName: true, stage: true } });
  if (!lead) return false;
  const invited = await prisma.notification.findUnique({ where: { dedupeKey: inviteKey(lead.id) }, select: { id: true } });
  if (!invited) return false;
  const t = text.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  await addLeadActivity(prisma, lead.id, "whatsapp", `Respondió a la invitación: «${text.trim().slice(0, 500)}»`);
  let what: string;
  let kind: "si" | "no" | "otro";
  if (NO.test(t)) {
    await setOptOut(prisma, from, true);
    await setLeadStage(prisma, lead.id, "PERDIDO", null, { lostReason: "No le interesa (respondió a la invitación por WhatsApp)" }).catch(() => false);
    what = "no le interesa";
    kind = "no";
  } else if (YES.test(t)) {
    if (["NUEVO", "CONTACTADO"].includes(lead.stage)) await setLeadStage(prisma, lead.id, "INTERESADO");
    await prisma.lead.update({ where: { id: lead.id }, data: { nextAction: "Mandar tarifas y agendar alta", nextActionAt: new Date() } });
    what = "¡le interesa!";
    kind = "si";
  } else {
    if (lead.stage === "NUEVO") await setLeadStage(prisma, lead.id, "CONTACTADO");
    await prisma.lead.update({ where: { id: lead.id }, data: { nextAction: "Contestar su mensaje de WhatsApp", nextActionAt: new Date() } });
    what = "escribió";
    kind = "otro";
  }
  await sendPush(prisma, await adminUserIds(prisma), { title: `Invitación Flex: ${lead.businessName} ${what}`, body: text.trim().slice(0, 120), url: `/admin/crm/${lead.id}`, tag: `flex-${lead.id}` }).catch(() => null);
  return kind;
}
