"use server";

import { driverByVehicle, gateCheckPackage, prisma, saveArrival, saveDeparture, type GateScan } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { GATE_ROLES } from "@/lib/roles";
import { saveEvidence } from "@/lib/uploads";
import { parseVehicleQr } from "@/lib/vehicle-qr";

/** Llavero escaneado → repartidor que hizo el último check matutino con esa moto. */
export async function identifyAction(raw: string): Promise<{ ok: true; driverId: string; via: string } | { ok: false; error: string }> {
  await requireUser(GATE_ROLES);
  const code = parseVehicleQr(raw);
  if (!code) return { ok: false, error: "Ese QR no es de un llavero de moto" };
  const r = await driverByVehicle(prisma, code);
  return r.ok ? { ok: true, driverId: r.driverId, via: `llavero ${r.vehicle}` } : r;
}

export async function checkPackageAction(driverId: string, raw: string, kind: "LLEGADA" | "SALIDA"): Promise<GateScan> {
  await requireUser(GATE_ROLES);
  return gateCheckPackage(prisma, driverId, String(raw).slice(0, 300), kind === "SALIDA" ? "SALIDA" : "LLEGADA");
}

export async function arrivalAction(input: { driverId: string; raws: string[]; signature: string; via: string }) {
  const user = await requireUser(GATE_ROLES);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.signature ?? "");
  if (!m) return { error: "Falta la firma" };
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 600_000 || buf[0] !== 0x89 || buf[1] !== 0x50) return { error: "Firma inválida" };
  const key = await saveEvidence(buf, "png", "gate");
  const r = await saveArrival(prisma, { driverId: input.driverId, raws: (input.raws ?? []).map(String), signatureKey: key, identifiedBy: String(input.via ?? "lista"), guardId: user.id });
  return { ok: r.ok, extra: r.extra.length, missing: r.missing.length };
}

export async function departureAction(input: { driverId: string; random: string; audit?: string[]; via: string }) {
  const user = await requireUser(GATE_ROLES);
  const r = await saveDeparture(prisma, { driverId: input.driverId, random: String(input.random), audit: input.audit?.map(String), identifiedBy: String(input.via ?? "lista"), guardId: user.id });
  return { ok: r.ok, audited: r.audited, extra: r.extra.length, missing: r.missing.length };
}
