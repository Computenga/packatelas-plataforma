// Acceso de clientes al portal:
// - Primer acceso: con su número de cliente (cmx00114) y los últimos 4 dígitos del WhatsApp que
//   tenemos registrado (para que nadie más active su cuenta con solo conocer el número, que aparece
//   en referencias de pago). Ahí crea su contraseña y deja su correo.
// - Si ya la activó: restablecer por correo con un enlace que vale 1 hora y deja de servir en cuanto
//   la contraseña cambia.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { hashPassword } from "./password.ts";
import { audit } from "./orders.ts";
import { phoneKey } from "./crm.ts";

const sign = (purpose: string, payload: string) => {
  const k = process.env.ENCRYPTION_KEY?.trim();
  if (!k) throw new Error("Falta ENCRYPTION_KEY");
  return createHmac("sha256", `${purpose}:${k}`).update(payload).digest("base64url").slice(0, 32);
};

/** Token firmado: usuario, caducidad y huella de la contraseña actual (cambia → el token muere). */
function makeToken(purpose: string, userId: string, passwordHash: string, minutes: number, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: now + minutes * 60_000, h: sign("pw", passwordHash).slice(0, 10) })).toString("base64url");
  return `${payload}.${sign(purpose, payload)}`;
}

async function readToken(prisma: PrismaClient, purpose: string, token: string, now = Date.now()) {
  const [payload, s] = token.split(".");
  if (!payload || !s) return null;
  const a = Buffer.from(sign(purpose, payload)), b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, e, h } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; e: number; h: string };
    if (!(e > now)) return null;
    const user = await prisma.user.findUnique({ where: { id: u } });
    if (!user || !user.active || sign("pw", user.passwordHash).slice(0, 10) !== h) return null;
    return user;
  } catch {
    return null;
  }
}

export const passwordProblem = (p: string) =>
  p.length < 8 ? "La contraseña debe tener al menos 8 caracteres" : !/[A-Za-zÑñ]/.test(p) || !/\d/.test(p) ? "Usa letras y números" : null;

export type FirstAccessStart =
  | { status: "ok"; token: string; name: string }
  | { status: "already" }
  | { status: "no_phone" }
  | { status: "invalid" };

/** Paso 1: número de cliente + últimos 4 del WhatsApp registrado. */
export async function startFirstAccess(prisma: PrismaClient, rawId: string, last4: string): Promise<FirstAccessStart> {
  const username = rawId.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username }, include: { client: { select: { name: true, phone: true, branches: { select: { phone: true } } } } } });
  if (!user || user.role !== "CLIENTE" || !user.active || !user.client) return { status: "invalid" };
  if (user.lastLoginAt || !user.mustChangePassword) return { status: "already" };
  const phones = [user.client.phone, ...user.client.branches.map((b) => b.phone)].map(phoneKey).filter((x): x is string => !!x);
  if (!phones.length) return { status: "no_phone" };
  const d = last4.replace(/\D/g, "");
  if (d.length !== 4 || !phones.some((p) => p.endsWith(d))) return { status: "invalid" };
  return { status: "ok", token: makeToken("first", user.id, user.passwordHash, 20), name: user.client.name };
}

/** Paso 2: crea su contraseña y guarda su correo (para restablecerla después). */
export async function completeFirstAccess(prisma: PrismaClient, token: string, password: string, email: string) {
  const user = await readToken(prisma, "first", token);
  if (!user || user.lastLoginAt) return { ok: false as const, error: "El enlace venció. Empieza de nuevo." };
  const problem = passwordProblem(password);
  if (problem) return { ok: false as const, error: problem };
  const mail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(mail)) return { ok: false as const, error: "Escribe un correo válido: lo usaremos si olvidas tu contraseña" };
  const taken = await prisma.user.findFirst({ where: { email: mail, NOT: { id: user.id } }, select: { id: true } });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: false, lastLoginAt: new Date(), ...(taken ? {} : { email: mail }) },
  });
  if (user.clientId) await prisma.client.updateMany({ where: { id: user.clientId, email: null }, data: { email: mail } });
  await audit(prisma, { actorUserId: user.id, action: "user.first_access", entity: "User", entityId: user.id, summary: `${user.username} activó su acceso al portal` });
  return { ok: true as const, userId: user.id, emailShared: !!taken };
}

/**
 * Restablecer: con número de cliente / usuario o correo. Devuelve a quién mandar el enlace
 * (o null si no aplica); la pantalla siempre responde lo mismo para no revelar cuentas.
 */
export async function passwordResetFor(prisma: PrismaClient, identifier: string) {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  const user = id.includes("@")
    ? await prisma.user.findFirst({ where: { email: id, active: true } })
    : await prisma.user.findUnique({ where: { username: id } });
  if (!user || !user.active) return null;
  const email = user.email ?? (user.clientId ? (await prisma.client.findUnique({ where: { id: user.clientId }, select: { email: true } }))?.email : null);
  if (!email) return { user, email: null, token: null };
  return { user, email, token: makeToken("reset", user.id, user.passwordHash, 60) };
}

export async function resetPassword(prisma: PrismaClient, token: string, password: string) {
  const user = await readToken(prisma, "reset", token);
  if (!user) return { ok: false as const, error: "El enlace venció o ya se usó. Pide uno nuevo." };
  const problem = passwordProblem(password);
  if (problem) return { ok: false as const, error: problem };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
  await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
  await audit(prisma, { actorUserId: user.id, action: "user.password_reset", entity: "User", entityId: user.id, summary: `${user.username} restableció su contraseña por correo` });
  return { ok: true as const };
}

/** Para mostrar en la pantalla: «••••• ••56» (sin revelar el teléfono completo). */
export const maskEmail = (e: string) => e.replace(/^(.{1,2})[^@]*(@.*)$/, (_, a: string, b: string) => `${a}•••${b}`);
