"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, hashPassword, prisma, Prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const STAFF = ["ADMIN", "OPERADOR", "DESPACHADOR", "REPARTIDOR", "EMPLEADO", "MECANICO"] as const;

const createSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Usuario: 3 a 40 letras, números, punto o guion"),
  name: z.string().trim().min(2, "Escribe el nombre"),
  role: z.enum(STAFF, { message: "Elige un rol" }),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  phone: z.string().trim().optional(),
});

export async function createUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const parsed = createSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await prisma.user.create({
      data: {
        username: d.username,
        name: d.name,
        role: d.role,
        passwordHash: await hashPassword(d.password),
        ...(d.role === "REPARTIDOR" ? { driver: { create: { phone: d.phone || undefined, vehicleType: "moto" } } } : {}),
      },
    });
    await audit(prisma, { actorUserId: admin.id, action: "user.created", entity: "User", entityId: user.id, summary: `Usuario ${d.username} (${d.role}) creado` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ese usuario ya existe" };
    throw e;
  }
  revalidatePath("/admin/usuarios");
  revalidatePath("/admin/repartidores");
  return { ok: `Usuario ${d.username} creado` };
}

export async function resetPassword(userId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) return { error: "Mínimo 8 caracteres" };
  const user = await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  await prisma.session.deleteMany({ where: { userId } }); // cierra sus sesiones abiertas
  await audit(prisma, { actorUserId: admin.id, action: "user.password_reset", entity: "User", entityId: userId, summary: `Contraseña de ${user.username} restablecida` });
  return { ok: "Contraseña actualizada" };
}

export async function toggleActive(userId: string) {
  const admin = await requireUser(["ADMIN"]);
  if (userId === admin.id) return;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({ where: { id: userId }, data: { active: !user.active } });
  if (user.active) await prisma.session.deleteMany({ where: { userId } });
  await audit(prisma, {
    actorUserId: admin.id,
    action: user.active ? "user.deactivated" : "user.activated",
    entity: "User",
    entityId: userId,
    summary: `${user.username} ${user.active ? "desactivado" : "activado"}`,
  });
  revalidatePath("/admin/usuarios");
}

/** Quita la verificación en dos pasos (teléfono perdido); el usuario la vuelve a activar [P09]. */
export async function resetTwoFactor(userId: string) {
  const admin = await requireUser(["ADMIN"]);
  if (userId === admin.id) return;
  const user = await prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpLastStep: null } });
  await prisma.session.deleteMany({ where: { userId } });
  await audit(prisma, { actorUserId: admin.id, action: "user.2fa_reset", entity: "User", entityId: userId, summary: `Verificación en dos pasos de ${user.username} restablecida` });
  revalidatePath("/admin/usuarios");
}
