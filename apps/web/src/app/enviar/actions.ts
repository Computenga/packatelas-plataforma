"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, startGuestShipment } from "@packatelas/db";

export type GuestState = { error?: string; values?: Record<string, string> };

const t = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max, msg);
const opt = (max: number) => z.string().trim().max(max).optional();
const tel = (msg: string) => z.string().trim().regex(/^\+?\d[\d\s-]{9,16}$/, msg);

const schema = z.object({
  senderName: t(3, 120, "Escribe tu nombre"),
  senderPhone: tel("Tu WhatsApp debe tener 10 dígitos"),
  senderEmail: z.string().trim().email("Correo inválido").max(160),
  pickupAddress: t(10, 250, "Escribe la dirección completa donde recogemos (calle, número, colonia, CP)"),
  pickupReference: opt(200),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige el día de recolección"),
  recipientName: t(3, 120, "Escribe el nombre de quien recibe"),
  recipientPhone: tel("El teléfono de quien recibe debe tener 10 dígitos"),
  addressLine: t(5, 200, "Escribe calle y número de entrega"),
  neighborhood: opt(120),
  city: t(3, 120, "Escribe la alcaldía o municipio de entrega"),
  zip: z.string().trim().regex(/^\d{5}$/, "Código postal de 5 dígitos"),
  instructions: opt(200),
  contents: t(3, 200, "Dinos qué se envía (p. ej. caja con ropa)"),
  terms: z.literal("on", { message: "Debes aceptar los términos del servicio" }),
});

export async function startGuest(_: GuestState, fd: FormData): Promise<GuestState> {
  const raw = Object.fromEntries(fd) as Record<string, string>;
  const values = Object.fromEntries(Object.entries(raw).filter(([k, v]) => typeof v === "string" && !k.startsWith("$")));
  if (raw.website) redirect("/enviar"); // campo trampa para bots
  const p = schema.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0].message, values };
  const base = process.env.PUBLIC_URL?.trim();
  if (!base) return { error: "Servicio no disponible por ahora", values };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let url: string;
  try {
    const { terms: _t, ...d } = p.data;
    void _t;
    url = (await startGuestShipment(prisma, { ...d, ip }, base)).url;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo iniciar el pago", values };
  }
  redirect(url);
}
