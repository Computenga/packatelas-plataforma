"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { completeFirstAccess, maskEmail, passwordResetFor, prisma, resetPassword, sendMail, startFirstAccess, windowCount } from "@packatelas/db";
import { ipFrom } from "@/lib/request-ip";
import { createSession } from "@/lib/session";

const SUPPORT_WA = "+52 56 1123 2342";
const base = () => (process.env.PUBLIC_URL ?? "https://portal.packatelas.mx").replace(/\/$/, "");

/** Límite de intentos por IP y por número de cliente (ventanas de 15 min). */
async function tooMany(id: string) {
  const ip = ipFrom(await headers());
  const [a, b] = await Promise.all([windowCount(prisma, `acceso-ip:${ip}`, 15, 0), windowCount(prisma, `acceso-id:${id.slice(0, 40)}`, 15, 0)]);
  return a >= 20 || b >= 6;
}
async function countTry(id: string) {
  const ip = ipFrom(await headers());
  await Promise.all([windowCount(prisma, `acceso-ip:${ip}`, 15), windowCount(prisma, `acceso-id:${id.slice(0, 40)}`, 15)]);
}

export type AccessState = { step?: "id" | "password"; token?: string; name?: string; id?: string; error?: string; info?: string; already?: boolean };

export async function startAccessAction(_: AccessState, fd: FormData): Promise<AccessState> {
  const id = String(fd.get("id") ?? "").trim().toLowerCase();
  const last4 = String(fd.get("last4") ?? "");
  if (!id) return { step: "id", error: "Escribe tu número de cliente (por ejemplo cmx00114)." };
  if (await tooMany(id)) return { step: "id", id, error: "Demasiados intentos. Espera 15 minutos." };
  const r = await startFirstAccess(prisma, id, last4);
  if (r.status === "ok") return { step: "password", token: r.token, name: r.name, id };
  if (r.status === "already") return { step: "id", id, already: true, info: "Esta cuenta ya se activó. Entra con tu contraseña o restablécela por correo." };
  if (r.status === "no_phone") return { step: "id", id, error: `No tenemos un WhatsApp registrado para validar tu cuenta. Escríbenos al ${SUPPORT_WA} y te ayudamos.` };
  await countTry(id);
  return { step: "id", id, error: "El número de cliente o los dígitos no coinciden con lo que tenemos registrado." };
}

export async function completeAccessAction(prev: AccessState, fd: FormData): Promise<AccessState> {
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { ...prev, error: "Las contraseñas no coinciden" };
  const r = await completeFirstAccess(prisma, String(fd.get("token") ?? ""), password, String(fd.get("email") ?? ""));
  if (!r.ok) return { ...prev, error: r.error };
  await createSession(r.userId);
  redirect("/cliente");
}

export type ResetState = { sent?: string; error?: string };

export async function requestResetAction(_: ResetState, fd: FormData): Promise<ResetState> {
  const id = String(fd.get("id") ?? "").trim().toLowerCase();
  if (!id) return { error: "Escribe tu número de cliente, usuario o correo." };
  if (await tooMany(id)) return { error: "Demasiados intentos. Espera 15 minutos." };
  await countTry(id);
  const r = await passwordResetFor(prisma, id);
  if (!r) return { error: "No encontramos esa cuenta. Revisa el número de cliente o escríbenos por WhatsApp." };
  if (!r.email || !r.token) return { error: `Tu cuenta no tiene correo registrado. Escríbenos por WhatsApp al ${SUPPORT_WA} para restablecerla.` };
  const link = `${base()}/acceso/nueva?t=${encodeURIComponent(r.token)}`;
  try {
    await sendMail(prisma, {
      to: r.email,
      subject: "Restablece tu contraseña de Packatelas",
      text: `Hola ${r.user.name}:\n\nPara crear una contraseña nueva entra a este enlace (vale 1 hora):\n${link}\n\nSi no lo pediste, ignora este correo.\n\nPackatelas`,
      html: `<div style="font-family:sans-serif;font-size:15px;color:#1e293b"><p>Hola ${r.user.name.replace(/[<>&]/g, "")}:</p><p>Para crear una contraseña nueva toca el botón (vale 1 hora):</p><p><a href="${link}" style="display:inline-block;background:#0f1e4a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">Crear contraseña nueva</a></p><p style="color:#64748b;font-size:13px">Si no lo pediste, ignora este correo.</p><p>Packatelas</p></div>`,
    });
  } catch (e) {
    console.error("[acceso] correo", e);
    return { error: `No pudimos mandar el correo en este momento. Escríbenos por WhatsApp al ${SUPPORT_WA}.` };
  }
  return { sent: maskEmail(r.email) };
}

export async function newPasswordAction(_: ResetState, fd: FormData): Promise<ResetState> {
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { error: "Las contraseñas no coinciden" };
  const r = await resetPassword(prisma, String(fd.get("token") ?? ""), password);
  if (!r.ok) return { error: r.error };
  redirect("/login?listo=1");
}
