"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, submitSignup } from "@packatelas/db";

export type SignupState = { error?: string; values?: Record<string, string> };

const t = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max, msg);
const opt = (max: number) => z.string().trim().max(max).optional();

const schema = z
  .object({
    businessName: t(2, 120, "Escribe el nombre de tu negocio"),
    contactName: t(3, 120, "Escribe tu nombre"),
    phone: z.string().trim().regex(/^\+?\d[\d\s-]{9,16}$/, "Teléfono inválido (10 dígitos)"),
    email: z.string().trim().email("Correo inválido").max(160),
    zone: z.enum(["cmx", "emx"], { message: "Elige dónde recolectamos" }),
    pickupAddress: t(10, 250, "Escribe la dirección completa de recolección (calle, número, colonia, CP)"),
    pickupReference: opt(200),
    monthlyVolume: opt(40),
    salesChannels: opt(200),
    rfc: z.string().trim().toUpperCase().regex(/^([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})?$/, "RFC inválido").optional(),
    legalName: opt(200),
    taxRegime: opt(120),
    taxZip: z.string().trim().regex(/^(\d{5})?$/, "CP fiscal inválido").optional(),
    cfdiUse: opt(120),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{4,30}$/, "Usuario: 4 a 30 letras, números, punto o guion, sin espacios"),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100),
    password2: z.string(),
    terms: z.literal("on", { message: "Debes aceptar los términos del servicio" }),
  })
  .refine((d) => d.password === d.password2, { message: "Las contraseñas no coinciden", path: ["password2"] });

export async function signup(_: SignupState, fd: FormData): Promise<SignupState> {
  const raw = Object.fromEntries(fd) as Record<string, string>;
  const values = Object.fromEntries(Object.entries(raw).filter(([k, v]) => typeof v === "string" && !k.startsWith("password") && !k.startsWith("$")));
  values.salesChannels = fd.getAll("salesChannels").join(", ");
  // Campo trampa: los bots lo llenan, las personas no lo ven.
  if (raw.website) redirect("/registro/enviado");

  const parsed = schema.safeParse({ ...raw, salesChannels: values.salesChannels });
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  const { password2: _p2, terms: _t, ...d } = parsed.data;
  void _p2;
  void _t;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  const r = await submitSignup(prisma, { ...d, ip });
  if (!r.ok) return { error: r.error, values };
  redirect("/registro/enviado");
}
