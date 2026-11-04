// Campaña «Invitar al portal»: WhatsApp (plantilla aprobada en Meta) a las tiendas que no han
// activado su acceso al portal o no han autorizado su cuenta de Mercado Libre.
// - Agrupa por teléfono (un mensaje por número).
// - Exclusiones guardadas por cliente (las decide el admin en Avisos).
// - Una sola vez por número y día (dedupeKey), y respeta las bajas (BAJA) de WhatsApp.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { NOTIFY_EVENTS, isOptedOut, renderPreview, waPhone } from "./notifications.ts";
import { audit } from "./orders.ts";

const OMIT_KEY = "portal_invite.omit";
const YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });

export async function getInviteOmit(prisma: PrismaClient): Promise<string[]> {
  const v = (await prisma.setting.findUnique({ where: { key: OMIT_KEY } }))?.value;
  return Array.isArray(v) ? (v as string[]) : [];
}

export async function setInviteOmit(prisma: PrismaClient, clientId: string, omit: boolean) {
  const cur = new Set(await getInviteOmit(prisma));
  if (omit) cur.add(clientId);
  else cur.delete(clientId);
  await prisma.setting.upsert({ where: { key: OMIT_KEY }, create: { key: OMIT_KEY, value: [...cur] }, update: { value: [...cur] } });
}

export type InviteClient = { id: string; publicId: string; name: string; activated: boolean; mlConnected: boolean; mlAccounts: number; omitted: boolean };
export type InviteGroup = { phone: string; name: string; event: "acceso_portal" | "conectar_ml"; params: string[]; preview: string; clients: InviteClient[]; omitted: boolean; lastSentAt: Date | null };

const first = (s?: string | null) => (s ?? "").trim().split(/\s+/)[0] || "";

/** Quién recibiría la invitación hoy (incluye los excluidos, marcados). */
export async function portalInviteTargets(prisma: PrismaClient): Promise<{ groups: InviteGroup[]; noPhone: InviteClient[] }> {
  const omit = new Set(await getInviteOmit(prisma));
  const clients = await prisma.client.findMany({
    where: { active: true, users: { some: { role: "CLIENTE", active: true } } },
    select: {
      id: true, publicId: true, name: true, contactName: true, phone: true,
      users: { where: { role: "CLIENTE", active: true }, select: { lastLoginAt: true, mustChangePassword: true } },
      mlAccounts: { select: { status: true } },
    },
    orderBy: { publicId: "asc" },
  });
  const byPhone = new Map<string, { contact: string; name: string; list: InviteClient[] }>();
  const noPhone: InviteClient[] = [];
  for (const c of clients) {
    const activated = c.users.some((u) => u.lastLoginAt && !u.mustChangePassword);
    const mlConnected = c.mlAccounts.some((a) => a.status === "ACTIVE");
    if (activated && mlConnected) continue;
    const ic: InviteClient = { id: c.id, publicId: c.publicId, name: c.name, activated, mlConnected, mlAccounts: c.mlAccounts.length, omitted: omit.has(c.id) };
    const to = waPhone(c.phone);
    if (!to) { noPhone.push(ic); continue; }
    const g = byPhone.get(to) ?? { contact: "", name: c.name, list: [] };
    if (!g.contact && c.contactName?.trim()) g.contact = c.contactName;
    g.list.push(ic);
    byPhone.set(to, g);
  }
  const sentRows = await prisma.notification.findMany({
    where: { event: { in: ["acceso_portal", "conectar_ml"] }, to: { in: [...byPhone.keys()] }, status: { not: "SKIPPED" } },
    select: { to: true, createdAt: true }, orderBy: { createdAt: "desc" },
  });
  const lastSent = new Map<string, Date>();
  for (const r of sentRows) if (!lastSent.has(r.to)) lastSent.set(r.to, r.createdAt);

  const groups: InviteGroup[] = [...byPhone.entries()].map(([phone, g]) => {
    const live = g.list.filter((c) => !c.omitted);
    const pendingAccess = live.find((c) => !c.activated);
    const event = pendingAccess ? "acceso_portal" : "conectar_ml";
    const who = first(g.contact) || g.name;
    const params = [who, (pendingAccess ?? live[0] ?? g.list[0]).publicId.toLowerCase()];
    return { phone, name: g.name, event, params, preview: renderPreview(event, params), clients: g.list, omitted: live.length === 0, lastSentAt: lastSent.get(phone) ?? null };
  });
  groups.sort((a, b) => a.clients[0].publicId.localeCompare(b.clients[0].publicId));
  return { groups, noPhone };
}

/** Encola la invitación a todos los números no excluidos (una vez por número y día). */
export async function sendPortalInvites(prisma: PrismaClient, actorUserId: string, now = new Date()) {
  const { groups } = await portalInviteTargets(prisma);
  const day = YMD.format(now);
  let queued = 0, skipped = 0;
  for (const g of groups) {
    if (g.omitted || (await isOptedOut(prisma, g.phone))) { skipped++; continue; }
    const created = await prisma.notification
      .create({
        data: {
          event: g.event, to: g.phone, template: NOTIFY_EVENTS[g.event].template, params: g.params, preview: g.preview,
          dedupeKey: `portal_invite:${g.phone}:${day}`, clientId: g.clients.find((c) => !c.omitted)?.id,
        },
      })
      .then(() => true)
      .catch(() => false); // ya se encoló hoy
    if (created) queued++; else skipped++;
  }
  await audit(prisma, { actorUserId, action: "notify.portal_invite", entity: "Notification", summary: `Invitación al portal: ${queued} WhatsApp encolados, ${skipped} omitidos` });
  return { queued, skipped };
}
