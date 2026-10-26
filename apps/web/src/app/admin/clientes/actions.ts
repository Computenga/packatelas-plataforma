"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, hashPassword, nextPublicId, prisma, Prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ID_PREFIXES } from "@packatelas/db/public-id";
import { opt } from "@/lib/format";
import type { ActionState } from "@/components/action-form";

const money = z.coerce.number().min(0, "No puede ser negativo").max(100000);

const createSchema = z.object({
  prefix: z.enum(ID_PREFIXES).default("cmx"),
  name: z.string().trim().min(2, "Escribe el nombre del cliente"),
  contactName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  tariffAmount: money,
  branchName: z.string().trim().min(1, "Escribe el nombre de la sucursal"),
  branchAddress: z.string().trim().min(5, "Escribe la dirección de recolección"),
});

export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = createSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const ids = await nextPublicId(prisma, d.prefix);
  const client = await prisma.client.create({
    data: {
      ...ids,
      name: d.name,
      contactName: opt(d.contactName ?? null),
      phone: opt(d.phone ?? null),
      email: opt(d.email ?? null),
      tariffAmount: d.tariffAmount,
      branches: { create: { name: d.branchName, address: d.branchAddress } },
    },
  });
  await audit(prisma, {
    actorUserId: user.id,
    action: "client.created",
    entity: "Client",
    entityId: client.id,
    summary: `Alta de cliente ${client.name} (${client.publicId})`,
  });
  redirect(`/admin/clientes/${client.id}`);
}

const updateSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del cliente"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  active: z.coerce.boolean().optional(),
  rfc: z.string().trim().toUpperCase().regex(/^([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})?$/, "RFC inválido").optional(),
  legalName: z.string().optional(),
  taxRegime: z.string().optional(),
  taxZip: z.string().trim().regex(/^(\d{5})?$/, "Código postal fiscal inválido").optional(),
  cfdiUse: z.string().optional(),
});

export async function updateClient(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = updateSchema.safeParse({ ...Object.fromEntries(fd), active: fd.get("active") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  await prisma.client.update({
    where: { id: clientId },
    data: {
      name: d.name,
      contactName: opt(d.contactName ?? null) ?? null,
      phone: opt(d.phone ?? null) ?? null,
      email: opt(d.email ?? null) ?? null,
      active: d.active ?? false,
      rfc: opt(d.rfc ?? null) ?? null,
      legalName: opt(d.legalName ?? null) ?? null,
      taxRegime: opt(d.taxRegime ?? null) ?? null,
      taxZip: opt(d.taxZip ?? null) ?? null,
      cfdiUse: opt(d.cfdiUse ?? null) ?? null,
    },
  });
  await audit(prisma, { actorUserId: user.id, action: "client.updated", entity: "Client", entityId: clientId, summary: `Datos de ${d.name} actualizados` });
  revalidatePath(`/admin/clientes/${clientId}`);
  return { ok: "Datos guardados" };
}

const tariffSchema = z.object({
  tariffMode: z.enum(["FIXED", "FLEX_DYNAMIC_PLUS_FIXED"]),
  tariffAmount: money,
  creditLimit: z.union([money, z.literal("")]).optional(),
});

export async function updateTariff(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = tariffSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const chargingEnabled = fd.get("chargingEnabled") === "on";
  const before = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  await prisma.client.update({
    where: { id: clientId },
    data: {
      tariffMode: d.tariffMode,
      tariffAmount: d.tariffAmount,
      chargingEnabled,
      creditLimit: d.creditLimit === "" || d.creditLimit === undefined ? null : d.creditLimit,
    },
  });
  await audit(prisma, {
    actorUserId: user.id,
    action: "client.tariff_updated",
    entity: "Client",
    entityId: clientId,
    summary: `Tarifa de ${before.name}: ${before.tariffAmount} → ${d.tariffAmount}; cobro ${chargingEnabled ? "habilitado" : "deshabilitado"}`,
  });
  revalidatePath(`/admin/clientes/${clientId}`);
  return { ok: "Tarifa guardada" };
}

const branchSchema = z.object({
  name: z.string().trim().min(1, "Escribe el nombre de la sucursal"),
  address: z.string().trim().min(5, "Escribe la dirección"),
  phone: z.string().optional(),
  lat: z.union([z.coerce.number().min(14).max(33), z.literal("")]).optional(),
  lng: z.union([z.coerce.number().min(-118).max(-86), z.literal("")]).optional(),
});

export async function addBranch(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = branchSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const days = fd.getAll("autoPickupDays").map(Number).filter((n) => n >= 1 && n <= 7);
  const branch = await prisma.branch.create({
    data: {
      clientId,
      name: d.name,
      address: d.address,
      phone: opt(d.phone ?? null),
      lat: d.lat === "" ? undefined : d.lat,
      lng: d.lng === "" ? undefined : d.lng,
      autoPickup: days.length > 0,
      autoPickupDays: days,
    },
  });
  await audit(prisma, { actorUserId: user.id, action: "branch.created", entity: "Branch", entityId: branch.id, summary: `Sucursal ${d.name} agregada` });
  revalidatePath(`/admin/clientes/${clientId}`);
  return { ok: `Sucursal ${d.name} agregada` };
}

const mlSchema = z.object({
  mlUserId: z.string().trim().regex(/^\d{4,15}$/, "El ID de vendedor ML son solo números"),
  nickname: z.string().trim().min(1, "Escribe el nombre de la cuenta"),
  branchId: z.string().min(1, "Elige la sucursal a la que llegan sus envíos"),
});

/**
 * Liga manualmente una cuenta ML a un cliente (para migrar las existentes).
 * La conexión normal la hará el propio cliente con OAuth [C02].
 */
export async function linkMlAccount(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = mlSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const acc = await prisma.mlAccount.create({
      data: {
        mlUserId: BigInt(d.mlUserId),
        nickname: d.nickname,
        clientId,
        status: "TOKEN_EXPIRED", // sin token hasta que el cliente autorice por OAuth
        routes: { create: { branchId: d.branchId, isDefault: true } },
      },
    });
    await audit(prisma, { actorUserId: user.id, action: "ml_account.linked", entity: "MlAccount", entityId: acc.id, summary: `Cuenta ML ${d.nickname} (${d.mlUserId}) ligada` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Esa cuenta ML ya está ligada a un cliente" };
    }
    throw e;
  }
  revalidatePath(`/admin/clientes/${clientId}`);
  return { ok: `Cuenta ${d.nickname} ligada` };
}

const portalUserSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Usuario: 3 a 40 letras, números, punto o guion"),
  name: z.string().trim().min(2, "Escribe el nombre"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export async function createPortalUser(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = portalUserSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const u = await prisma.user.create({
      data: { username: d.username, name: d.name, role: "CLIENTE", clientId, passwordHash: await hashPassword(d.password) },
    });
    await audit(prisma, { actorUserId: user.id, action: "user.created", entity: "User", entityId: u.id, summary: `Acceso al portal para ${d.username}` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ese usuario ya existe" };
    throw e;
  }
  revalidatePath(`/admin/clientes/${clientId}`);
  return { ok: `Usuario ${d.username} creado` };
}
