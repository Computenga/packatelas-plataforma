import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Paso intermedio del inicio de sesión con verificación en dos pasos [P09]: la contraseña ya
// fue correcta y falta el código. Cookie firmada que vence en 5 minutos.
const COOKIE = "pk_2fa";
const TTL_MS = 5 * 60_000;

function sign(payload: string) {
  const k = process.env.ENCRYPTION_KEY?.trim();
  if (!k) throw new Error("Falta ENCRYPTION_KEY");
  return createHmac("sha256", `2fa:${k}`).update(payload).digest("base64url");
}

export async function setPendingLogin(userId: string) {
  const payload = `${userId}.${Date.now() + TTL_MS}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/login",
    maxAge: TTL_MS / 1000,
  });
}

export async function readPendingLogin(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [userId, exp, sig] = raw.split(".");
  if (!userId || !exp || !sig) return null;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  if (Number(exp) < Date.now()) return null;
  return userId;
}

export async function clearPendingLogin() {
  (await cookies()).delete({ name: COOKIE, path: "/login" });
}
