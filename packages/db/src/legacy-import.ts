// Migración del sistema anterior (admin.packatelas.mx y Shipday) sin saldos [A21].
// - Usuarios del equipo con su rol; repartidores con su carrier de Shipday.
// - Vínculos de drivers Flex.
// - Un usuario por cliente para su portal.
// Todos con una contraseña temporal que deben cambiar al entrar. Re-ejecutable: lo que ya existe
// no se toca y se reporta.
import type { PrismaClient, Role } from "../generated/prisma/client.ts";
import { hashPassword } from "./password.ts";
import { audit } from "./orders.ts";

export type LegacyUserRow = { username: string; name: string; role: Role; carrierId: number | null; active: boolean };

const ROLE_BY_CODE: Record<string, Role> = { A: "ADMIN", O: "OPERADOR", D: "DESPACHADOR", R: "REPARTIDOR", ADMINISTRADOR: "ADMIN", OPERADOR: "OPERADOR", DESPACHADOR: "DESPACHADOR", REPARTIDOR: "REPARTIDOR" };

/** Formato: usuario|rol|nombre|carrier|activo, separados por «;» o saltos de línea. */
export function parseLegacyUsers(text: string): { rows: LegacyUserRow[]; errors: string[] } {
  const rows: LegacyUserRow[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[;\n\r]+/).map((x) => x.trim()).filter(Boolean)) {
    const [u, r, n, c, a] = raw.split("|").map((x) => (x ?? "").trim());
    const username = (u ?? "").toLowerCase();
    const role = ROLE_BY_CODE[(r ?? "").toUpperCase()];
    if (!/^[a-z0-9._-]{2,40}$/.test(username) || !role) {
      errors.push(raw.slice(0, 60));
      continue;
    }
    const name = n || username.replace(/[_.]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    rows.push({ username, name, role, carrierId: /^\d+$/.test(c ?? "") ? Number(c) : null, active: a !== "0" });
  }
  return { rows, errors };
}

export function validTempPassword(p: string) {
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

export async function importLegacyUsers(prisma: PrismaClient, rows: LegacyUserRow[], tempPassword: string, actorUserId: string) {
  if (!validTempPassword(tempPassword)) throw new Error("La contraseña temporal debe tener 8+ caracteres con letras y números");
  const hash = await hashPassword(tempPassword);
  const created: string[] = [], skipped: string[] = [];
  for (const r of rows) {
    const exists = await prisma.user.findUnique({ where: { username: r.username }, select: { id: true } });
    if (exists) {
      skipped.push(r.username);
      continue;
    }
    const carrierTaken = r.carrierId != null && (await prisma.driver.findUnique({ where: { legacyCarrierId: r.carrierId }, select: { id: true } }));
    await prisma.user.create({
      data: {
        username: r.username,
        name: r.name,
        role: r.role,
        active: r.active,
        passwordHash: hash,
        mustChangePassword: true,
        ...(r.role === "REPARTIDOR" ? { driver: { create: { vehicleType: "moto", active: r.active, legacyCarrierId: carrierTaken ? null : r.carrierId } } } : {}),
      },
    });
    created.push(r.username);
  }
  await audit(prisma, { actorUserId, action: "migration.users", entity: "User", summary: `Migración: ${created.length} usuarios creados, ${skipped.length} ya existían` });
  return { created, skipped };
}

export type FlexLinkRow = { flexDriverId: string; username: string; shipmentId: string | null };

export function parseFlexLinks(text: string) {
  const rows: FlexLinkRow[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [f, u, s] = line.split(/[,;\t|]/).map((x) => x.trim());
    if (!/^\d{3,15}$/.test(f ?? "") || !u) continue;
    rows.push({ flexDriverId: f, username: u.toLowerCase(), shipmentId: /^\d{10,13}$/.test(s ?? "") ? s : null });
  }
  return rows;
}

export async function importFlexLinks(prisma: PrismaClient, rows: FlexLinkRow[], actorUserId: string) {
  const linked: string[] = [], kept: string[] = [], missing: string[] = [];
  for (const r of rows) {
    const user = await prisma.user.findUnique({ where: { username: r.username }, include: { driver: true } });
    if (!user?.driver) {
      missing.push(`${r.flexDriverId} → ${r.username}`);
      continue;
    }
    const cur = await prisma.flexIdentity.findUnique({ where: { flexDriverId: BigInt(r.flexDriverId) }, include: { driver: { include: { user: { select: { username: true } } } } } });
    if (cur) {
      // Ya vinculado en la plataforma nueva: lo de aquí manda (es más reciente).
      if (cur.driverId !== user.driver.id) kept.push(`${r.flexDriverId}: se queda con ${cur.driver.user.username} (antes ${r.username})`);
      continue;
    }
    await prisma.flexIdentity.create({ data: { flexDriverId: BigInt(r.flexDriverId), driverId: user.driver.id, lastShipmentId: r.shipmentId ? BigInt(r.shipmentId) : null } });
    linked.push(`${r.flexDriverId} → ${r.username}`);
  }
  await audit(prisma, { actorUserId, action: "migration.flex", entity: "FlexIdentity", summary: `Migración: ${linked.length} drivers Flex vinculados, ${kept.length} conservados, ${missing.length} sin repartidor` });
  return { linked, kept, missing };
}

/** Un usuario de portal por cliente activo que aún no tenga (usuario = ID del cliente, p. ej. cmx00114). */
export async function createClientUsers(prisma: PrismaClient, tempPassword: string, actorUserId: string) {
  if (!validTempPassword(tempPassword)) throw new Error("La contraseña temporal debe tener 8+ caracteres con letras y números");
  const hash = await hashPassword(tempPassword);
  const clients = await prisma.client.findMany({ where: { active: true, users: { none: {} } }, select: { id: true, publicId: true, name: true, email: true }, orderBy: { publicId: "asc" } });
  const created: { username: string; name: string }[] = [], skipped: string[] = [];
  for (const c of clients) {
    const username = c.publicId.toLowerCase();
    if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) {
      skipped.push(username);
      continue;
    }
    const email = c.email?.trim().toLowerCase() || null;
    const emailFree = email ? !(await prisma.user.findUnique({ where: { email }, select: { id: true } })) : false;
    await prisma.user.create({ data: { username, name: c.name, role: "CLIENTE", clientId: c.id, email: emailFree ? email : null, passwordHash: hash, mustChangePassword: true } });
    created.push({ username, name: c.name });
  }
  await audit(prisma, { actorUserId, action: "migration.client_users", entity: "User", summary: `Migración: ${created.length} usuarios de clientes creados` });
  return { created, skipped };
}
