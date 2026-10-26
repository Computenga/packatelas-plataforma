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

/**
 * Importa motos pegadas desde la pestaña "Vehiculos" de la app de flotilla actual (solo lectura de ella):
 * vehiculo_id, placa, marca, modelo, anio, color, num_serie, km_actual, estatus. Re-ejecutable por ID.
 */
export async function importVehiclesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const lines = String(fd.get("text") ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { error: "Pega las motos" };
  const head = lines[0].split(/\t|,/).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  if (col("vehiculo_id") < 0) return { error: "Falta la columna vehiculo_id (copia desde la fila de encabezados)" };
  let created = 0, updated = 0;
  for (const l of lines.slice(1)) {
    const c = l.split(/\t|,/).map((x) => x.trim());
    const get = (n: string) => (col(n) >= 0 ? c[col(n)] ?? "" : "");
    const code = get("vehiculo_id").toUpperCase();
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) continue;
    const year = Number(get("anio")), km = Number(get("km_actual"));
    const status = /baja/i.test(get("estatus")) ? "BAJA" : /taller/i.test(get("estatus")) ? "TALLER" : "ACTIVO";
    const data = {
      plate: get("placa").toUpperCase() || null, brand: get("marca") || null, model: get("modelo") || null,
      year: year >= 1990 && year <= 2100 ? year : null, color: get("color") || null, vin: get("num_serie") || null,
      status: status as "ACTIVO" | "TALLER" | "BAJA",
    };
    const prev = await prisma.vehicle.findUnique({ where: { code } });
    if (prev) {
      await prisma.vehicle.update({ where: { code }, data: { ...data, ...(Number.isFinite(km) && km > prev.km ? { km } : {}) } });
      updated++;
    } else {
      await prisma.vehicle.create({ data: { code, ...data, km: Number.isFinite(km) && km >= 0 ? Math.round(km) : 0 } });
      created++;
    }
  }
  await audit(prisma, { actorUserId: user.id, action: "fleet.vehicles_imported", entity: "Vehicle", entityId: "import", summary: `Motos importadas: ${created} nuevas, ${updated} actualizadas` });
  revalidatePath("/mecanico/motos");
  return { ok: `${created} moto(s) nuevas, ${updated} actualizadas` };
}
