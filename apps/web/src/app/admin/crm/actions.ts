"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addLeadActivity, canonicalMunicipio, createLead, normalizeStoreUrl, linkLeadClient, phoneKey, prisma, setLeadStage, LEAD_SOURCES, type LeadStage } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const MANUAL_STAGES: LeadStage[] = ["NUEVO", "CONTACTADO", "INTERESADO", "PERDIDO"];
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

/** "2026-11-03" → ese día a las 9:00 de la Ciudad de México. */
function dayAt9(ymd: string | null | undefined) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T15:00:00.000Z`);
}

const leadSchema = z.object({
  businessName: z.string().trim().min(2, "Escribe el nombre del negocio").max(160),
  contactName: opt(120),
  phone: opt(30).refine((v) => !v || phoneKey(v), "Teléfono inválido (10 dígitos)"),
  email: z.string().trim().max(160).optional().transform((v) => v || null).refine((v) => !v || z.string().email().safeParse(v).success, "Correo inválido"),
  zone: z.enum(["cmx", "emx", ""]).optional().transform((v) => v || null),
  municipality: opt(80),
  monthlyVolume: opt(40),
  salesChannels: z.string().trim().max(500).optional().transform((v) => v || null)
    .refine((v) => !v || !!normalizeStoreUrl(v), "«Dónde vende» debe ser un link (ej. mercadolibre.com.mx/tienda/…, su página o Instagram)")
    .transform((v) => normalizeStoreUrl(v)),
  notes: opt(2000),
  source: z.enum(LEAD_SOURCES.map((s) => s.key) as [string, ...string[]]).default("MANUAL"),
  ownerId: opt(40),
});

export async function createLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const p = leadSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!p.data.phone && !p.data.email) return { error: "Pon al menos un teléfono o un correo para poder contactarlo" };
  const r = await createLead(prisma, { ...p.data, source: p.data.source as never }, user.id);
  const next = dayAt9(String(fd.get("nextActionAt") ?? ""));
  if (r.created && next) await prisma.lead.update({ where: { id: r.id }, data: { nextActionAt: next, nextAction: String(fd.get("nextAction") || "Primer contacto") } });
  revalidatePath("/admin/crm");
  redirect(`/admin/crm/${r.id}${r.created ? "" : "?ya=1"}`);
}

export async function updateLeadAction(leadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  const p = leadSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const muni = canonicalMunicipio(p.data.municipality);
  await prisma.lead.update({
    where: { id: leadId },
    data: { ...p.data, municipality: muni?.name ?? null, zone: p.data.zone ?? muni?.zone ?? null, source: p.data.source as never, phoneKey: phoneKey(p.data.phone), email: p.data.email?.toLowerCase() ?? null },
  });
  revalidatePath(`/admin/crm/${leadId}`);
  revalidatePath("/admin/crm");
  return { ok: "Datos guardados" };
}

export async function stageAction(leadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const stage = String(fd.get("stage")) as LeadStage;
  if (!MANUAL_STAGES.includes(stage)) return { error: "Esa etapa la marca el sistema solo" };
  try {
    const changed = await setLeadStage(prisma, leadId, stage, user.id, { lostReason: String(fd.get("lostReason") ?? "") });
    if (!changed) return { ok: "Ya estaba en esa etapa" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo cambiar" };
  }
  revalidatePath(`/admin/crm/${leadId}`);
  revalidatePath("/admin/crm");
  return { ok: "Etapa actualizada" };
}

/** Registrar contacto o nota, y de paso dejar el siguiente paso. */
export async function activityAction(leadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const type = String(fd.get("type") ?? "nota");
  const text = String(fd.get("text") ?? "").trim();
  if (!["nota", "llamada", "whatsapp", "visita"].includes(type)) return { error: "Tipo inválido" };
  if (!text) return { error: "Escribe qué pasó" };
  await addLeadActivity(prisma, leadId, type, text, user.id);
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { stage: true } });
  // Primer contacto real: de Nuevo pasa a Contactado sin que haya que moverlo a mano.
  if (lead?.stage === "NUEVO" && type !== "nota") await setLeadStage(prisma, leadId, "CONTACTADO", user.id);
  const nextAt = dayAt9(String(fd.get("nextActionAt") ?? ""));
  const nextAction = String(fd.get("nextAction") ?? "").trim();
  if (nextAt || nextAction || fd.get("clearNext") === "on") {
    await prisma.lead.update({
      where: { id: leadId },
      data: fd.get("clearNext") === "on" ? { nextAction: null, nextActionAt: null } : { nextAction: nextAction || "Dar seguimiento", nextActionAt: nextAt ?? new Date() },
    });
  }
  revalidatePath(`/admin/crm/${leadId}`);
  revalidatePath("/admin/crm");
  return { ok: "Registrado" };
}

export async function assignAction(leadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const ownerId = String(fd.get("ownerId") ?? "") || null;
  const owner = ownerId ? await prisma.user.findFirst({ where: { id: ownerId, role: { in: ["ADMIN", "OPERADOR", "DESPACHADOR"] }, active: true }, select: { name: true } }) : null;
  if (ownerId && !owner) return { error: "Usuario no válido" };
  await prisma.lead.update({ where: { id: leadId }, data: { ownerId } });
  await addLeadActivity(prisma, leadId, "sistema", owner ? `Asignado a ${owner.name}` : "Sin responsable", user.id);
  revalidatePath(`/admin/crm/${leadId}`);
  return { ok: "Responsable actualizado" };
}

/** Ligar a un cliente existente por su ID (cmx00123) o desde las coincidencias sugeridas. */
export async function linkClientAction(leadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const raw = String(fd.get("client") ?? "").trim();
  if (!raw) return { error: "Escribe el ID del cliente (ej. cmx00123)" };
  const c = await prisma.client.findFirst({ where: { OR: [{ id: raw }, { publicId: { equals: raw, mode: "insensitive" } }] }, select: { id: true } });
  if (!c) return { error: "No encontré ese cliente" };
  const r = await linkLeadClient(prisma, leadId, c.id, user.id);
  if (!r.ok) return { error: r.error };
  revalidatePath(`/admin/crm/${leadId}`);
  revalidatePath("/admin/crm");
  return { ok: "Ligado. Las siguientes etapas avanzan solas." };
}
