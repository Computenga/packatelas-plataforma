"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, closeRepair, discardFault, prisma, Prisma, startRepair, upsertVehicleDocument } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const ROLES = ["MECANICO", "ADMIN"] as const;
const keys = (fd: FormData, name: string) => fd.getAll(name).map(String).filter((k) => /^fleet\//.test(k)).slice(0, 8);

export async function startRepairAction(faultId: string) {
  const user = await requireUser([...ROLES]);
  await startRepair(prisma, faultId, user.id);
  revalidatePath("/mecanico");
}

export async function discardAction(faultId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser([...ROLES]);
  const note = String(fd.get("note") ?? "").trim();
  if (note.length < 3) return { error: "Escribe por qué se descarta" };
  if (!(await discardFault(prisma, faultId, note, user.id))) return { error: "Ya no está abierta" };
  revalidatePath("/mecanico");
  return { ok: "Descartada" };
}

export async function closeRepairAction(repairId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser([...ROLES]);
  const cause = String(fd.get("cause"));
  if (!["desgaste", "mal_uso", "ambos"].includes(cause)) return { error: "Elige la causa" };
  const amount = fd.get("employeeAmount") ? Number(fd.get("employeeAmount")) : undefined;
  const r = await closeRepair(prisma, repairId, {
    description: String(fd.get("description") ?? "").trim(), photos: keys(fd, "photos"),
    partsCost: Number(fd.get("partsCost") || 0), laborCost: Number(fd.get("laborCost") || 0),
    cause: cause as "desgaste" | "mal_uso" | "ambos", responsibleId: String(fd.get("responsibleId") || "") || null, employeeAmount: amount,
  }, user.id);
  if (!r.ok) return { error: r.error };
  revalidatePath("/mecanico");
  return { ok: "Reparación cerrada" };
}

export async function saveDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser([...ROLES]);
  const s = z.object({
    vehicleId: z.string().min(1, "Elige la moto"), type: z.string().min(1),
    folio: z.string().max(60).optional(), issuedAt: z.string().optional(), expiresAt: z.string().optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!s.success) return { error: s.error.issues[0].message };
  try {
    await upsertVehicleDocument(prisma, { ...s.data, evidenceKey: keys(fd, "evidence")[0] }, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidatePath("/mecanico/documentos");
  return { ok: "Documento guardado" };
}

const vehicleSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^M-[A-Z0-9]{1,6}$/, "El ID va como M-01"),
  plate: z.string().trim().toUpperCase().max(12).optional(), brand: z.string().trim().max(40).optional(), model: z.string().trim().max(40).optional(),
  year: z.union([z.coerce.number().int().min(1990).max(2100), z.literal("")]).optional(), color: z.string().trim().max(30).optional(),
  vin: z.string().trim().max(30).optional(), km: z.coerce.number().int().min(0).max(999999),
  size: z.enum(["chica", "grande"]), ownership: z.enum(["empresa", "propia"]), status: z.enum(["ACTIVO", "TALLER", "BAJA"]),
  notes: z.string().trim().max(500).optional(),
});

export async function saveVehicleAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser([...ROLES]);
  const p = vehicleSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const d = { ...p.data, year: p.data.year === "" || p.data.year === undefined ? null : p.data.year };
  try {
    const v = id ? await prisma.vehicle.update({ where: { id }, data: d }) : await prisma.vehicle.create({ data: d });
    await audit(prisma, { actorUserId: user.id, action: id ? "fleet.vehicle_updated" : "fleet.vehicle_created", entity: "Vehicle", entityId: v.id, summary: `Moto ${v.code} ${id ? "actualizada" : "dada de alta"}` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ese ID de moto ya existe" };
    throw e;
  }
  revalidatePath("/mecanico/motos");
  return { ok: id ? "Guardado" : "Moto dada de alta" };
}
