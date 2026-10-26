"use server";

import { redirect } from "next/navigation";
import { decryptSecret, prisma, verifyTotp } from "@packatelas/db";
import { createSession } from "@/lib/session";
import { clearPendingLogin, readPendingLogin } from "@/lib/two-factor";
import { homeFor } from "@/lib/roles";

const attempts = new Map<string, { n: number; until: number }>();

export async function verifyLogin(_: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const userId = await readPendingLogin();
  if (!userId) redirect("/login?vencido=1");
  const a = attempts.get(userId);
  if (a && a.n >= 5 && a.until > Date.now()) return { error: "Demasiados intentos. Vuelve a iniciar sesión en 15 minutos." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.active || !user.totpSecret) redirect("/login");
  const step = verifyTotp(decryptSecret(user.totpSecret), String(fd.get("code") ?? ""), { lastStep: user.totpLastStep });
  if (step == null) {
    attempts.set(userId, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    return { error: "Código incorrecto o vencido. Usa el que aparece ahora en tu app." };
  }
  // Solo se acepta si nadie usó ese mismo código antes (condición en la misma escritura).
  const used = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step, lastLoginAt: new Date() },
  });
  if (!used.count) return { error: "Ese código ya se usó; espera el siguiente." };
  attempts.delete(userId);
  await clearPendingLogin();
  await createSession(user.id);
  redirect(homeFor(user.role));
}
