"use server";

import { redirect } from "next/navigation";
import { audit, hashPassword, prisma, verifyPassword } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

export type ChangeState = { error?: string };

export async function changePasswordAction(_: ChangeState, fd: FormData): Promise<ChangeState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("password") ?? "");
  const again = String(fd.get("confirm") ?? "");
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(current, row.passwordHash))) return { error: "La contraseña actual no es correcta" };
  if (next.length < 8) return { error: "La nueva contraseña debe tener al menos 8 caracteres" };
  if (!/[A-Za-zÑñ]/.test(next) || !/\d/.test(next)) return { error: "Usa letras y números" };
  if (next !== again) return { error: "Las contraseñas no coinciden" };
  if (await verifyPassword(next, row.passwordHash)) return { error: "La nueva contraseña debe ser distinta a la temporal" };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  // Cierra las demás sesiones abiertas con la contraseña anterior.
  await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
  await audit(prisma, { actorUserId: user.id, action: "user.password_changed", entity: "User", entityId: user.id, summary: `${user.username} cambió su contraseña` });
  redirect("/login?listo=1");
}
