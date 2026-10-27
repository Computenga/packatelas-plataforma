"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { hashPassword, prisma, verifyPassword, windowCount } from "@packatelas/db";
import { ipFrom } from "@/lib/request-ip";
import { createSession, destroySession } from "@/lib/session";
import { setPendingLogin } from "@/lib/two-factor";
import { homeFor } from "@/lib/roles";

export type LoginState = { error?: string; username?: string };

// Intentos fallidos en ventanas de 15 min, guardados en la base (sobreviven reinicios):
// por usuario (cualquier IP) y por IP (cualquier usuario).
const WINDOW_MIN = 15;
const MAX_PER_USER = 8;
const MAX_PER_IP = 40;
// Para usuarios que no existen se verifica contra un hash cualquiera: así tarda lo mismo
// y no se puede averiguar qué usuarios existen por el tiempo de respuesta.
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword("contraseña-que-no-existe-" + Math.random()));

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Escribe tu usuario y contraseña.", username };

  const ip = ipFrom(await headers());
  const userKey = `login-user:${username.slice(0, 60)}`;
  const ipKey = `login-ip:${ip}`;
  const [byUser, byIp] = await Promise.all([windowCount(prisma, userKey, WINDOW_MIN, 0), windowCount(prisma, ipKey, WINDOW_MIN, 0)]);
  if (byUser >= MAX_PER_USER || byIp >= MAX_PER_IP) {
    return { error: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.", username };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !user.active || !ok) {
    await Promise.all([windowCount(prisma, userKey, WINDOW_MIN), windowCount(prisma, ipKey, WINDOW_MIN)]);
    return { error: "Usuario o contraseña incorrectos.", username };
  }

  if (user.totpSecret) {
    // Falta el código de la app autenticadora [P09].
    await setPendingLogin(user.id);
    redirect("/login/verificar");
  }
  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  redirect(homeFor(user.role));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
