"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { completeEmployeeAccess, prisma, startEmployeeAccess, windowCount } from "@packatelas/db";
import { homeFor } from "@/lib/roles";
import { ipFrom } from "@/lib/request-ip";
import { createSession } from "@/lib/session";

export type EmpAccessState = { step?: "id" | "password"; token?: string; name?: string; rfc?: string; no?: string; error?: string; already?: string };

export async function startEmpAccessAction(_: EmpAccessState, fd: FormData): Promise<EmpAccessState> {
  const rfc = String(fd.get("rfc") ?? "").trim();
  const no = String(fd.get("no") ?? "").trim();
  const ip = ipFrom(await headers());
  const keys = [`acceso-emp-ip:${ip}`, `acceso-emp-no:${no.slice(0, 10)}`];
  const [a, b] = await Promise.all(keys.map((k) => windowCount(prisma, k, 15, 0)));
  if (a >= 20 || b >= 6) return { step: "id", rfc, no, error: "Demasiados intentos. Espera 15 minutos." };
  const r = await startEmployeeAccess(prisma, rfc, no);
  if (r.status === "ok") return { step: "password", token: r.token, name: r.name, rfc, no };
  if (r.status === "already") return { step: "id", rfc, no, already: r.username };
  await Promise.all(keys.map((k) => windowCount(prisma, k, 15)));
  return { step: "id", rfc, no, error: "El RFC o el número de empleado no coinciden con tu registro. Si eres nuevo o cambió tu RFC, pídele a RH que lo revise." };
}

export async function completeEmpAccessAction(prev: EmpAccessState, fd: FormData): Promise<EmpAccessState> {
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { ...prev, error: "Las contraseñas no coinciden" };
  const r = await completeEmployeeAccess(prisma, String(fd.get("token") ?? ""), password, String(fd.get("email") ?? ""));
  if (!r.ok) return { ...prev, error: r.error };
  await createSession(r.userId);
  redirect(homeFor(r.role));
}
