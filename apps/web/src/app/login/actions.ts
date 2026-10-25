"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma, verifyPassword } from "@packatelas/db";
import { createSession, destroySession } from "@/lib/session";
import { homeFor } from "@/lib/roles";

export type LoginState = { error?: string; username?: string };

// Límite simple de intentos fallidos por usuario+IP (en memoria; suficiente para un solo servidor).
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Escribe tu usuario y contraseña.", username };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${username}|${ip}`;
  const f = failures.get(key);
  if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
    return { error: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.", username };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user?.active && (await verifyPassword(password, user.passwordHash));
  if (!user || !ok) {
    const count = (f && f.until > Date.now() ? f.count : 0) + 1;
    failures.set(key, { count, until: Date.now() + LOCK_MS });
    return { error: "Usuario o contraseña incorrectos.", username };
  }

  failures.delete(key);
  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  redirect(homeFor(user.role));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
