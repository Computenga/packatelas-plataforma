"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, audit, hashPassword, passwordProblem, prisma, removeBranch } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import type { ActionState } from "@/components/action-form";

const branchSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre (por ejemplo «Bodega Centro»)").max(80),
  address: z.string().trim().min(5, "Escribe la dirección completa").max(300),
  phone: z.string().trim().max(30).optional(),
  lat: z.union([z.coerce.number().min(14).max(33), z.literal("")]).optional(),
  lng: z.union([z.coerce.number().min(-118).max(-86), z.literal("")]).optional(),
});

/** La tienda agrega una dirección de recolección. */
export async function addBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const p = branchSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await prisma.branch.create({
    data: { clientId, name: d.name, address: d.address, phone: d.phone || null, lat: d.lat === "" ? undefined : d.lat, lng: d.lng === "" ? undefined : d.lng },
  });
  const orphan = await prisma.mlAccount.findMany({ where: { clientId, routes: { none: {} } }, select: { id: true } });
  if (orphan.length) await prisma.mlAccountRoute.createMany({ data: orphan.map((a) => ({ mlAccountId: a.id, branchId: b.id, isDefault: true })) });
  await audit(prisma, { actorUserId: user.id, action: "branch.created", entity: "Branch", entityId: b.id, summary: `La tienda agregó la dirección ${d.name}` });
  revalidatePath("/cliente/negocio");
  return { ok: `Dirección «${d.name}» agregada. Ya puedes pedir recolecciones ahí.` };
}

export async function removeBranchAction(branchId: string, _: ActionState): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const b = await prisma.branch.findFirst({ where: { id: branchId, clientId } });
  if (!b) return { error: "Dirección no encontrada" };
  const r = await removeBranch(prisma, branchId, user.id);
  revalidatePath("/cliente/negocio");
  return r.ok ? { ok: "Dirección quitada" } : { error: r.error.replace("del cliente", "") };
}

const userSchema = z.object({
  suffix: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,20}$/, "Usuario: 2 a 20 letras o números, sin espacios"),
  name: z.string().trim().min(2, "Escribe el nombre de la persona").max(80),
  password: z.string(),
});

/** La tienda da acceso a alguien de su equipo: usuario «cmx00114-ana». */
export async function addUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const p = userSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const problem = passwordProblem(p.data.password);
  if (problem) return { error: problem };
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { publicId: true } });
  const username = `${client.publicId.toLowerCase()}-${p.data.suffix}`;
  try {
    const u = await prisma.user.create({ data: { username, name: p.data.name, role: "CLIENTE", clientId, passwordHash: await hashPassword(p.data.password) } });
    await audit(prisma, { actorUserId: user.id, action: "user.created", entity: "User", entityId: u.id, summary: `La tienda creó el acceso ${username}` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ese usuario ya existe; elige otro" };
    throw e;
  }
  revalidatePath("/cliente/negocio");
  return { ok: `Acceso creado. Usuario: ${username}` };
}

export async function toggleUserAction(userId: string, _: ActionState): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  if (userId === user.id) return { error: "No puedes desactivar tu propio acceso" };
  const u = await prisma.user.findFirst({ where: { id: userId, clientId, role: "CLIENTE" } });
  if (!u) return { error: "Usuario no encontrado" };
  await prisma.user.update({ where: { id: u.id }, data: { active: !u.active } });
  if (u.active) await prisma.session.deleteMany({ where: { userId: u.id } });
  await audit(prisma, { actorUserId: user.id, action: u.active ? "user.deactivated" : "user.reactivated", entity: "User", entityId: u.id, summary: `${u.username} ${u.active ? "desactivado" : "reactivado"} por la tienda` });
  revalidatePath("/cliente/negocio");
  return { ok: u.active ? "Acceso desactivado" : "Acceso reactivado" };
}
