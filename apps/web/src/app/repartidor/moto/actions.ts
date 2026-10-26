"use server";

import { revalidatePath } from "next/cache";
import { createBeforeRouteCheck, createMorningCheck, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { employeeOf } from "@/lib/employee-session";
import type { ActionState } from "@/components/action-form";

const keys = (fd: FormData, name: string) => fd.getAll(name).map(String).filter((k) => /^fleet\//.test(k)).slice(0, 8);
const num = (v: FormDataEntryValue | null) => (v == null || v === "" ? undefined : Number(v));

export async function morningCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["REPARTIDOR", "MECANICO", "ADMIN"]);
  const emp = await employeeOf(user.id);
  if (!emp) return { error: "Tu usuario no está ligado a tu expediente; pídelo en oficina" };
  const faults = fd.getAll("faultDesc").map((d, i) => ({ description: String(d), severity: String(fd.getAll("faultSev")[i] ?? "media"), photos: keys(fd, `faultPhotos_${i}`) }));
  const amount = num(fd.get("fuelAmount"));
  const r = await createMorningCheck(prisma, {
    vehicleId: String(fd.get("vehicleId") ?? ""), employeeId: emp.id, km: Number(fd.get("km")),
    photos: keys(fd, "photos"), odometerKey: keys(fd, "odometer")[0] ?? "",
    faults, fuel: amount ? { amount, liters: num(fd.get("fuelLiters")), ticketKey: keys(fd, "ticket")[0] } : null,
    lat: num(fd.get("lat")), lng: num(fd.get("lng")),
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/repartidor/moto");
  return { ok: `Check guardado${r.kmDriven != null ? ` · ${r.kmDriven} km desde el último check` : ""}${faults.filter((f) => f.description.trim()).length ? " · fallas enviadas al mecánico" : ""}` };
}

export async function beforeRouteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["REPARTIDOR", "MECANICO", "ADMIN"]);
  const emp = await employeeOf(user.id);
  if (!emp) return { error: "Tu usuario no está ligado a tu expediente; pídelo en oficina" };
  const r = await createBeforeRouteCheck(prisma, {
    vehicleId: String(fd.get("vehicleId") ?? ""), employeeId: emp.id, photos: keys(fd, "photos"),
    description: String(fd.get("description") ?? ""), severity: String(fd.get("severity") ?? "media"),
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/repartidor/moto");
  return { ok: "Daño reportado al mecánico" };
}
