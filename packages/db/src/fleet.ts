// Flotilla [A24]. Mismas reglas que la app actual:
// - Check matutino (entrega de la moto): 4 fotos + odómetro + km. Los km desde el check
//   matutino anterior de esa moto se le asignan a quien hace este check (incluye casa-trabajo).
//   Las fallas que reporta son "reportadas" y él es el responsable (trajo la moto).
// - Check antes de ruta: daños que no se reportaron en la mañana → falla "no_reportada" cuyo
//   responsable es quien hizo el check matutino de esa moto hoy.
// - Una carga de gasolina al día, ligada al check matutino.
// - El mecánico cierra la falla con fotos, costos y quién paga; la parte del empleado queda
//   como adeudo sin aprobación (se le avisa).
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { sendPush } from "./push.ts";

type Db = PrismaClient | Prisma.TransactionClient;
const TZ = "-06:00";
const YMD_MX = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const ymdMx = (d: Date) => YMD_MX.format(d);
const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00${TZ}`);

export const DOC_TYPES: Record<string, string> = {
  tarjeta_circulacion: "Tarjeta de circulación",
  seguro: "Póliza de seguro",
  verificacion: "Verificación",
  permiso: "Permiso de circulación",
  refrendo: "Refrendo / tenencia",
  factura: "Factura",
};
export const ALERT_DAYS = [30, 15, 7];

export type FleetResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type FaultInput = { description: string; severity?: string; photos?: string[] };

export async function createMorningCheck(
  prisma: PrismaClient,
  input: {
    vehicleId: string; employeeId: string; km: number; photos: string[]; odometerKey: string;
    faults?: FaultInput[]; fuel?: { amount: number; liters?: number; ticketKey?: string } | null; lat?: number; lng?: number; now?: Date;
  },
): Promise<FleetResult<{ checkId: string; kmDriven: number | null }>> {
  if (input.photos.length !== 4) return { ok: false, error: "Toma las 4 fotos de la moto" };
  if (!input.odometerKey) return { ok: false, error: "Falta la foto del odómetro" };
  if (!Number.isInteger(input.km) || input.km < 0) return { ok: false, error: "Kilometraje inválido" };
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const [v] = await tx.$queryRaw<{ id: string; km: number; status: string; code: string }[]>`SELECT id, km, status, code FROM "Vehicle" WHERE id = ${input.vehicleId} FOR UPDATE`;
    if (!v) return { ok: false as const, error: "Moto no encontrada" };
    if (v.status === "BAJA") return { ok: false as const, error: `${v.code} está dada de baja` };
    if (input.km < v.km) return { ok: false as const, error: `El km (${input.km}) es menor al último registrado (${v.km}). Revisa el odómetro.` };
    const today = ymdMx(now);
    const dup = await tx.vehicleCheck.findFirst({ where: { vehicleId: v.id, kind: "MATUTINO", at: { gte: dayStart(today) } } });
    if (dup) return { ok: false as const, error: `${v.code} ya tiene check matutino hoy` };
    const prev = await tx.vehicleCheck.findFirst({ where: { vehicleId: v.id, kind: "MATUTINO" }, orderBy: { at: "desc" }, select: { km: true } });
    const kmDriven = prev?.km != null ? input.km - prev.km : null;
    const check = await tx.vehicleCheck.create({
      data: { kind: "MATUTINO", vehicleId: v.id, employeeId: input.employeeId, at: now, km: input.km, kmDriven, photos: input.photos, odometerKey: input.odometerKey, lat: input.lat, lng: input.lng },
    });
    await tx.vehicle.update({ where: { id: v.id }, data: { km: input.km } });
    for (const f of input.faults ?? []) {
      if (!f.description?.trim()) continue;
      await tx.fault.create({
        data: { kind: "reportada", checkId: check.id, vehicleId: v.id, reportedById: input.employeeId, responsibleId: input.employeeId, description: f.description.trim().slice(0, 500), severity: f.severity ?? "media", photos: f.photos ?? [] },
      });
    }
    if (input.fuel && input.fuel.amount > 0) {
      await tx.fuelLoad.create({
        data: { checkId: check.id, vehicleId: v.id, employeeId: input.employeeId, at: now, amount: new Prisma.Decimal(input.fuel.amount), liters: input.fuel.liters ? new Prisma.Decimal(input.fuel.liters) : null, ticketKey: input.fuel.ticketKey },
      });
    }
    return { ok: true as const, checkId: check.id, kmDriven };
  });
}

/** Check antes de ruta: crea una falla "no reportada" a cargo de quien hizo el check matutino. */
export async function createBeforeRouteCheck(
  prisma: PrismaClient,
  input: { vehicleId: string; employeeId: string; photos: string[]; description: string; severity?: string; now?: Date },
): Promise<FleetResult<{ faultId: string | null }>> {
  if (!input.photos.length || input.photos.length > 4) return { ok: false, error: "Agrega de 1 a 4 fotos del daño" };
  if (input.description.trim().length < 5) return { ok: false, error: "Describe el daño" };
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const morning = await tx.vehicleCheck.findFirst({
      where: { vehicleId: input.vehicleId, kind: "MATUTINO", at: { gte: dayStart(ymdMx(now)) } },
      orderBy: { at: "desc" },
    });
    const check = await tx.vehicleCheck.create({
      data: { kind: "ANTES_RUTA", vehicleId: input.vehicleId, employeeId: input.employeeId, at: now, photos: input.photos, description: input.description.trim().slice(0, 500) },
    });
    const fault = await tx.fault.create({
      data: {
        kind: "no_reportada", checkId: check.id, vehicleId: input.vehicleId, reportedById: input.employeeId,
        responsibleId: morning?.employeeId ?? null, description: input.description.trim().slice(0, 500), severity: input.severity ?? "media", photos: input.photos,
      },
    });
    return { ok: true as const, faultId: fault.id };
  }).then(async (r) => {
    const users = await prisma.user.findMany({ where: { active: true, role: { in: ["MECANICO", "ADMIN"] } }, select: { id: true } });
    const v = await prisma.vehicle.findUnique({ where: { id: input.vehicleId }, select: { code: true } });
    void sendPush(prisma, users.map((u) => u.id), { title: `Falla reportada en ${v?.code ?? "moto"}`, body: input.description.trim().slice(0, 120), url: "/mecanico", tag: "fallas" });
    return r;
  });
}

export async function startRepair(prisma: PrismaClient, faultId: string, mechanicUserId: string): Promise<FleetResult<{ repairId: string }>> {
  return prisma.$transaction(async (tx) => {
    const [f] = await tx.$queryRaw<{ id: string; status: string; vehicleId: string }[]>`SELECT id, status, "vehicleId" FROM "Fault" WHERE id = ${faultId} FOR UPDATE`;
    if (!f) return { ok: false as const, error: "Falla no encontrada" };
    if (f.status !== "ABIERTA") return { ok: false as const, error: "La falla ya se está atendiendo o está cerrada" };
    const r = await tx.repair.create({ data: { faultId, vehicleId: f.vehicleId, mechanicUserId } });
    await tx.fault.update({ where: { id: faultId }, data: { status: "EN_REPARACION" } });
    await tx.vehicle.update({ where: { id: f.vehicleId }, data: { status: "TALLER" } });
    return { ok: true as const, repairId: r.id };
  });
}

export type CloseRepairInput = {
  description: string; photos: string[]; partsCost: number; laborCost: number;
  cause: "desgaste" | "mal_uso" | "ambos"; responsibleId?: string | null; employeeAmount?: number;
};

/** Cierra la reparación; la parte del empleado queda como adeudo (sin aprobación). */
export async function closeRepair(prisma: PrismaClient, repairId: string, input: CloseRepairInput, actorUserId?: string): Promise<FleetResult> {
  const total = Math.round((input.partsCost + input.laborCost) * 100) / 100;
  if (input.partsCost < 0 || input.laborCost < 0) return { ok: false, error: "Costos inválidos" };
  if (!input.photos.length) return { ok: false, error: "Agrega al menos una foto de la reparación" };
  let employeeAmount = 0;
  if (input.cause === "mal_uso") employeeAmount = input.employeeAmount ?? total;
  if (input.cause === "ambos") employeeAmount = input.employeeAmount ?? 0;
  if (employeeAmount < 0 || employeeAmount > total + 0.005) return { ok: false, error: "El monto del empleado no puede ser mayor al total" };
  if (input.cause === "ambos" && (employeeAmount <= 0 || employeeAmount >= total)) return { ok: false, error: "En 'ambos' indica cuánto paga el empleado (menos que el total)" };
  if (employeeAmount > 0 && !input.responsibleId) return { ok: false, error: "Indica qué empleado paga" };
  return prisma.$transaction(async (tx) => {
    const r = await tx.repair.findUnique({ where: { id: repairId }, include: { vehicle: { select: { code: true } } } });
    if (!r) return { ok: false as const, error: "Reparación no encontrada" };
    if (r.closedAt) return { ok: false as const, error: "Ya estaba cerrada" };
    await tx.repair.update({
      where: { id: repairId },
      data: {
        closedAt: new Date(), description: input.description.slice(0, 1000), photos: input.photos,
        partsCost: new Prisma.Decimal(input.partsCost), laborCost: new Prisma.Decimal(input.laborCost), cause: input.cause,
        responsibleId: employeeAmount > 0 ? input.responsibleId : input.responsibleId ?? null,
        employeeAmount: new Prisma.Decimal(employeeAmount), companyAmount: new Prisma.Decimal(Math.round((total - employeeAmount) * 100) / 100),
      },
    });
    if (r.faultId) await tx.fault.update({ where: { id: r.faultId }, data: { status: "CERRADA" } });
    const stillOpen = await tx.repair.count({ where: { vehicleId: r.vehicleId, closedAt: null, id: { not: repairId } } });
    if (!stillOpen) await tx.vehicle.update({ where: { id: r.vehicleId }, data: { status: "ACTIVO" } });
    if (employeeAmount > 0 && input.responsibleId) {
      await tx.employeeCharge.create({
        data: { employeeId: input.responsibleId, amount: new Prisma.Decimal(employeeAmount), description: `Reparación ${r.vehicle.code}: ${input.description.slice(0, 120)}`, repairId, createdById: actorUserId },
      });
    }
    await audit(tx, { actorUserId, action: "fleet.repair_closed", entity: "Repair", entityId: repairId, summary: `Reparación de ${r.vehicle.code} cerrada: $${total}${employeeAmount ? `, empleado paga $${employeeAmount}` : ""}` });
    return { ok: true as const };
  });
}

export async function discardFault(prisma: PrismaClient, faultId: string, note: string, actorUserId?: string) {
  const r = await prisma.fault.updateMany({ where: { id: faultId, status: "ABIERTA" }, data: { status: "DESCARTADA", mechanicNote: note.slice(0, 300) } });
  if (r.count) await audit(prisma, { actorUserId, action: "fleet.fault_discarded", entity: "Fault", entityId: faultId, summary: `Falla descartada: ${note}` });
  return r.count > 0;
}

export async function upsertVehicleDocument(
  prisma: PrismaClient,
  d: { vehicleId: string; type: string; folio?: string; issuedAt?: string; expiresAt?: string; evidenceKey?: string },
  actorUserId?: string,
) {
  if (!DOC_TYPES[d.type]) throw new Error("Tipo de documento inválido");
  const data = {
    folio: d.folio || null,
    issuedAt: d.issuedAt ? new Date(`${d.issuedAt}T00:00:00Z`) : null,
    expiresAt: d.expiresAt ? new Date(`${d.expiresAt}T00:00:00Z`) : null,
    ...(d.evidenceKey ? { evidenceKey: d.evidenceKey } : {}),
    updatedById: actorUserId,
  };
  return prisma.vehicleDocument.upsert({ where: { vehicleId_type: { vehicleId: d.vehicleId, type: d.type } }, update: data, create: { vehicleId: d.vehicleId, type: d.type, ...data } });
}

/** Documentos vencidos o por vencer en los próximos `days` días. */
export async function expiringDocuments(db: Db, days = 30, now = new Date()) {
  const limit = new Date(`${ymdMx(new Date(now.getTime() + days * 86400_000))}T00:00:00Z`);
  const docs = await db.vehicleDocument.findMany({
    where: { expiresAt: { lte: limit }, vehicle: { status: { not: "BAJA" } } },
    include: { vehicle: { select: { code: true, plate: true } } },
    orderBy: { expiresAt: "asc" },
  });
  const today = new Date(`${ymdMx(now)}T00:00:00Z`).getTime();
  return docs.map((d) => ({ ...d, daysLeft: Math.round((d.expiresAt!.getTime() - today) / 86400_000) }));
}

/** Motos activas sin check matutino hoy (para avisar después de la hora límite). */
export async function vehiclesWithoutMorningCheck(db: Db, now = new Date()) {
  const start = dayStart(ymdMx(now));
  return db.vehicle.findMany({
    where: { status: "ACTIVO", checks: { none: { kind: "MATUTINO", at: { gte: start } } } },
    select: { id: true, code: true, plate: true },
    orderBy: { code: "asc" },
  });
}

/** Costos y uso por moto y por empleado en un rango [A24]. */
export async function fleetReport(db: Db, from: Date, to: Date) {
  const [vehicles, repairs, fuel, checks, charges] = await Promise.all([
    db.vehicle.findMany({ select: { id: true, code: true, plate: true, size: true, status: true }, orderBy: { code: "asc" } }),
    db.repair.findMany({ where: { closedAt: { gte: from, lt: to } }, include: { fault: { select: { createdAt: true } } } }),
    db.fuelLoad.findMany({ where: { at: { gte: from, lt: to } } }),
    db.vehicleCheck.findMany({ where: { kind: "MATUTINO", at: { gte: from, lt: to } }, select: { vehicleId: true, employeeId: true, kmDriven: true } }),
    db.employeeCharge.findMany({ where: { createdAt: { gte: from, lt: to } } }),
  ]);
  const byVehicle = vehicles.map((v) => {
    const rs = repairs.filter((r) => r.vehicleId === v.id);
    const fs = fuel.filter((f) => f.vehicleId === v.id);
    const km = checks.filter((c) => c.vehicleId === v.id).reduce((a, c) => a + Math.max(0, c.kmDriven ?? 0), 0);
    const liters = fs.reduce((a, f) => a + Number(f.liters ?? 0), 0);
    const fuelCost = fs.reduce((a, f) => a + Number(f.amount), 0);
    const repairCost = rs.reduce((a, r) => a + Number(r.partsCost) + Number(r.laborCost), 0);
    return { ...v, km, fuelCost, liters, kmPerLiter: liters && km ? Math.round((km / liters) * 10) / 10 : null, repairs: rs.length, repairCost, costPerKm: km ? Math.round(((fuelCost + repairCost) / km) * 100) / 100 : null };
  });
  const empIds = [...new Set([...checks.map((c) => c.employeeId), ...fuel.map((f) => f.employeeId), ...charges.map((c) => c.employeeId)])];
  const byEmployee = empIds.map((id) => ({
    employeeId: id,
    km: checks.filter((c) => c.employeeId === id).reduce((a, c) => a + Math.max(0, c.kmDriven ?? 0), 0),
    fuelCost: fuel.filter((f) => f.employeeId === id).reduce((a, f) => a + Number(f.amount), 0),
    charges: charges.filter((c) => c.employeeId === id).reduce((a, c) => a + Number(c.amount), 0),
  }));
  const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3600_000;
  const resp = repairs.filter((r) => r.fault).map((r) => hours(r.fault!.createdAt, r.startedAt));
  const fix = repairs.filter((r) => r.closedAt).map((r) => hours(r.startedAt, r.closedAt!));
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return { byVehicle, byEmployee, mechanic: { repairs: repairs.length, avgResponseHours: avg(resp), avgRepairHours: avg(fix) } };
}
