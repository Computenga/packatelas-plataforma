"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createApplication, findApplication, prisma, submitApplication } from "@packatelas/db";

export async function startApplication(fd: FormData) {
  // Freno contra abuso del formulario público: más de 40 altas nuevas en una hora es anormal.
  const recent = await prisma.hireApplication.count({ where: { createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= 40) redirect("/alta?ocupado=1");
  const { token } = await createApplication(prisma, String(fd.get("role") ?? "repartidor"));
  redirect(`/alta/${token}`);
}

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const schema = z.object({
  name: z.string().trim().min(5, "Escribe tu nombre completo").max(160),
  phone: z.string().trim().regex(/^\+?\d[\d\s-]{9,16}$/, "Teléfono a 10 dígitos"),
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")).transform((v) => v || null),
  curp: z.string().trim().toUpperCase().regex(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/, "Revisa tu CURP (18 caracteres)"),
  rfc: z.string().trim().toUpperCase().regex(/^([A-ZÑ&]{4}\d{6}[A-Z0-9]{3})?$/, "Revisa tu RFC (13 caracteres)").optional().transform((v) => v || null),
  nss: z.string().trim().regex(/^(\d{11})?$/, "El NSS son 11 dígitos").optional().transform((v) => v || null),
  address: opt(300),
  clabe: z.string().trim().regex(/^(\d{18})?$/, "La CLABE son 18 dígitos").optional().transform((v) => v || null),
  bank: opt(60), emergencyName: opt(120), emergencyPhone: opt(20), emergencyRelation: opt(40),
});

export type AltaState = { error?: string; ok?: string; values?: Record<string, string> };

export async function saveApplicationData(token: string, _: AltaState, fd: FormData): Promise<AltaState> {
  const app = await findApplication(prisma, token);
  if (!app || app.status === "APROBADA" || app.status === "RECHAZADA") return { error: "Esta solicitud ya no se puede editar" };
  const raw = Object.fromEntries([...fd].map(([k, x]) => [k, String(x)]));
  const p = schema.safeParse(raw);
  // Regresamos lo capturado para que el formulario no se borre al marcar el error.
  if (!p.success) return { error: p.error.issues[0].message, values: raw };
  await prisma.hireApplication.update({ where: { id: app.id }, data: p.data });
  return { ok: "Datos guardados", values: Object.fromEntries(Object.entries(p.data).map(([k, x]) => [k, x ?? ""])) };
}

export async function submitAction(token: string): Promise<AltaState> {
  const app = await findApplication(prisma, token);
  if (!app) return { error: "Enlace inválido" };
  const r = await submitApplication(prisma, app.id);
  if (!r.ok) return { error: `Falta: ${r.missing.join(", ")}` };
  redirect(`/alta/${token}?enviada=1`);
}
