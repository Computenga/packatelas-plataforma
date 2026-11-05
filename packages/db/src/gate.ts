// Recepción (vigilante): control digital de paquetes de los repartidores.
// - LLEGADA (mañana): se escanean todos los paquetes que trae; cada uno debe estar a su nombre.
// - SALIDA a ruta: se escanea uno al azar; si no es suyo, auditoría uno por uno.
// Al repartidor se le identifica por el llavero de la moto con la que hizo su último check
// matutino (quien hace el check es quien trae los paquetes) o buscándolo en la lista.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { IN_ROUTE } from "./dispatch.ts";
import { parseScan } from "./scan.ts";
import { todayMx } from "./pickups.ts";
import { sendPush } from "./push.ts";

/** Las bajas se muestran como «sin acceso» durante este tiempo. */
const BAJA_VISIBLE_DAYS = 60;

export type GateRow = {
  driverId: string;
  name: string;
  employeeNo: number | null;
  hasPhoto: boolean;
  active: boolean;
  endDate: Date | null;
  expected: number;
  arrival: { at: Date; ok: boolean; scanned: number; extra: number; missing: number } | null;
  departure: { at: Date; ok: boolean; audited: boolean } | null;
};

export type GatePkg = { orderId: string; code: string };
export type GateScan = { raw: string; code: string; orderId: string | null; assigned: boolean };

/** Lista del día: repartidores activos y bajas recientes (sin acceso), con lo que deben traer. */
export async function gateRoster(prisma: PrismaClient, ymd = todayMx()): Promise<GateRow[]> {
  const since = new Date(Date.now() - BAJA_VISIBLE_DAYS * 86_400_000);
  const drivers = await prisma.driver.findMany({
    where: { user: { role: "REPARTIDOR" } },
    select: {
      id: true, active: true, photoKey: true,
      user: { select: { name: true, active: true, updatedAt: true, employee: { select: { employeeNo: true, status: true, endDate: true } } } },
      _count: { select: { custodies: { where: { endedAt: null } } } },
      gateChecks: { where: { ymd }, orderBy: { at: "desc" }, select: { kind: true, at: true, ok: true, audited: true, scanned: true, extra: true, missing: true } },
    },
  });
  const rows: GateRow[] = [];
  for (const d of drivers) {
    const emp = d.user.employee;
    const active = d.active && d.user.active && emp?.status !== "BAJA";
    if (!active) {
      const left = emp?.endDate ?? d.user.updatedAt;
      if (left < since) continue;
    }
    const arr = d.gateChecks.find((g) => g.kind === "LLEGADA");
    const dep = d.gateChecks.find((g) => g.kind === "SALIDA");
    rows.push({
      driverId: d.id, name: d.user.name, employeeNo: emp?.employeeNo ?? null, hasPhoto: !!d.photoKey, active,
      endDate: active ? null : (emp?.endDate ?? null), expected: d._count.custodies,
      arrival: arr ? { at: arr.at, ok: arr.ok, scanned: (arr.scanned as unknown[]).length, extra: (arr.extra as unknown[]).length, missing: (arr.missing as unknown[]).length } : null,
      departure: dep ? { at: dep.at, ok: dep.ok, audited: dep.audited } : null,
    });
  }
  return rows.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es"));
}

/** Llavero (folio de la moto) → repartidor que hizo el último check matutino con ella. */
export async function driverByVehicle(prisma: PrismaClient, vehicleCode: string) {
  const v = await prisma.vehicle.findUnique({ where: { code: vehicleCode }, select: { id: true, code: true } });
  if (!v) return { ok: false as const, error: `No existe la moto ${vehicleCode}` };
  const check = await prisma.vehicleCheck.findFirst({ where: { vehicleId: v.id, kind: "MATUTINO" }, orderBy: { at: "desc" }, select: { employeeId: true, at: true } });
  if (!check) return { ok: false as const, error: `Nadie ha hecho check matutino con la ${v.code}: búscalo en la lista` };
  const emp = await prisma.employee.findUnique({ where: { id: check.employeeId }, select: { name: true, user: { select: { driver: { select: { id: true } } } } } });
  const driverId = emp?.user?.driver?.id;
  if (!driverId) return { ok: false as const, error: `${emp?.name ?? "Quien hizo el check"} no tiene usuario de repartidor: búscalo en la lista` };
  return { ok: true as const, driverId, vehicle: v.code, checkAt: check.at };
}

/** Paquetes que el sistema dice que trae (su inventario abierto). */
export async function gateExpected(prisma: PrismaClient, driverId: string): Promise<GatePkg[]> {
  const rows = await prisma.driverCustody.findMany({ where: { driverId, endedAt: null }, select: { order: { select: { id: true, code: true } } }, orderBy: { startedAt: "asc" } });
  return rows.map((r) => ({ orderId: r.order.id, code: r.order.code }));
}

/** Paquetes que lleva a ruta: asignados en ruta o en su inventario. */
async function routeSet(prisma: PrismaClient, driverId: string): Promise<GatePkg[]> {
  const [assigned, custody] = await Promise.all([
    prisma.order.findMany({ where: { driverId, status: { in: IN_ROUTE } }, select: { id: true, code: true } }),
    gateExpected(prisma, driverId),
  ]);
  const map = new Map<string, GatePkg>(custody.map((c) => [c.orderId, c]));
  for (const o of assigned) map.set(o.id, { orderId: o.id, code: o.code });
  return [...map.values()];
}

export async function gateRouteCount(prisma: PrismaClient, driverId: string) {
  return (await routeSet(prisma, driverId)).length;
}

/** QR de ML, código PK/DV o etiqueta externa registrada → pedido. */
async function findPackage(prisma: PrismaClient, raw: string) {
  const p = parseScan(raw);
  if (p.kind === "CODE") return prisma.order.findUnique({ where: { code: p.code }, select: { id: true, code: true } });
  if (p.kind === "ML") return prisma.order.findUnique({ where: { mlShipmentId: p.shipmentId }, select: { id: true, code: true } });
  const ref = raw.trim().slice(0, 120);
  return ref ? prisma.order.findFirst({ where: { externalRef: ref }, select: { id: true, code: true } }) : null;
}

/** Revisa un paquete escaneado contra el repartidor (llegada: su inventario; salida: lo que lleva a ruta). */
export async function gateCheckPackage(prisma: PrismaClient, driverId: string, raw: string, kind: "LLEGADA" | "SALIDA"): Promise<GateScan> {
  const o = await findPackage(prisma, raw);
  if (!o) return { raw, code: raw.trim().slice(0, 40), orderId: null, assigned: false };
  const set = kind === "LLEGADA" ? await gateExpected(prisma, driverId) : await routeSet(prisma, driverId);
  return { raw, code: o.code, orderId: o.id, assigned: set.some((x) => x.orderId === o.id) };
}

function compare(expected: GatePkg[], scanned: GateScan[]) {
  const seen = new Set(scanned.filter((s) => s.orderId).map((s) => s.orderId));
  const extra = scanned.filter((s) => !s.assigned).map((s) => ({ code: s.code, orderId: s.orderId }));
  const missing = expected.filter((e) => !seen.has(e.orderId));
  return { extra, missing, ok: extra.length === 0 && missing.length === 0 };
}

async function dedupe(prisma: PrismaClient, driverId: string, raws: string[], kind: "LLEGADA" | "SALIDA") {
  const out: GateScan[] = [];
  for (const raw of raws.slice(0, 400)) {
    const s = await gateCheckPackage(prisma, driverId, raw, kind);
    if (out.some((x) => (s.orderId ? x.orderId === s.orderId : x.code === s.code))) continue;
    out.push(s);
  }
  return out;
}

async function alertDiff(prisma: PrismaClient, driverId: string, title: string, body: string) {
  const ids = (await prisma.user.findMany({ where: { role: { in: ["ADMIN", "DESPACHADOR"] }, active: true }, select: { id: true } })).map((u) => u.id);
  await sendPush(prisma, ids, { title, body, url: "/admin/recepcion", tag: `gate-${driverId}` }).catch(() => null);
}

/** Llegada: guarda lo escaneado, la firma y avisa a despacho si no cuadra. */
export async function saveArrival(
  prisma: PrismaClient,
  input: { driverId: string; raws: string[]; signatureKey: string; identifiedBy: string; guardId: string },
) {
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: input.driverId }, select: { user: { select: { name: true } } } });
  const expected = await gateExpected(prisma, input.driverId);
  const scanned = await dedupe(prisma, input.driverId, input.raws, "LLEGADA");
  const { extra, missing, ok } = compare(expected, scanned);
  const row = await prisma.gateCheck.create({
    data: {
      kind: "LLEGADA", driverId: input.driverId, guardId: input.guardId, ymd: todayMx(), identifiedBy: input.identifiedBy.slice(0, 40),
      expected, scanned, extra, missing, ok, signatureKey: input.signatureKey,
    },
  });
  if (!ok) {
    await alertDiff(prisma, input.driverId, `⚠️ Recepción: ${driver.user.name} no cuadra`,
      [extra.length && `${extra.length} paquete(s) que no son suyos (${extra.map((e) => e.code).join(", ")})`, missing.length && `le faltan ${missing.length} (${missing.map((m) => m.code).join(", ")})`].filter(Boolean).join(" · "));
  }
  return { id: row.id, ok, extra, missing, scanned: scanned.length, expected: expected.length };
}

/**
 * Salida a ruta: `raws` es el paquete al azar (1) o, si no era suyo, todos los de la auditoría.
 * En auditoría también se marcan los suyos que no aparecieron.
 */
export async function saveDeparture(
  prisma: PrismaClient,
  input: { driverId: string; random: string; audit?: string[]; identifiedBy: string; guardId: string },
) {
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: input.driverId }, select: { user: { select: { name: true } } } });
  const expected = await routeSet(prisma, input.driverId);
  const pick = await gateCheckPackage(prisma, input.driverId, input.random, "SALIDA");
  const audited = !pick.assigned;
  let scanned: GateScan[] = [pick];
  let extra: { code: string; orderId: string | null }[] = audited ? [{ code: pick.code, orderId: pick.orderId }] : [];
  let missing: GatePkg[] = [];
  if (audited && input.audit) {
    scanned = await dedupe(prisma, input.driverId, [input.random, ...input.audit], "SALIDA");
    ({ extra, missing } = compare(expected, scanned));
  }
  const ok = !audited;
  const row = await prisma.gateCheck.create({
    data: { kind: "SALIDA", driverId: input.driverId, guardId: input.guardId, ymd: todayMx(), identifiedBy: input.identifiedBy.slice(0, 40), expected, scanned, extra, missing, ok, audited },
  });
  if (audited) {
    await alertDiff(prisma, input.driverId, `🚨 Recepción: auditoría a ${driver.user.name}`,
      `Al salir, ${pick.code} no era suyo.` + (input.audit ? ` Auditoría: ${extra.length} no asignado(s), ${missing.length} faltante(s).` : ""));
  }
  return { id: row.id, ok, audited, extra, missing, scanned: scanned.length, expected: expected.length };
}
