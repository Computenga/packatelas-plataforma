// Migración del sistema anterior (admin.packatelas.mx y Shipday) sin saldos [A21].
// - Usuarios del equipo con su rol; repartidores con su carrier de Shipday.
// - Vínculos de drivers Flex.
// - Un usuario por cliente para su portal.
// Todos con una contraseña temporal que deben cambiar al entrar. Re-ejecutable: lo que ya existe
// no se toca y se reporta.
import type { Prisma, PrismaClient, Role } from "../generated/prisma/client.ts";
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

// ── Historial de pagos (sin saldos) ──

export type LegacyPaymentRow = { date: string; publicId: string; amount: number; reference: string; method: "TRANSFER" | "MERCADOPAGO" | "OTHER"; note: string; key: string };

/** CSV propio de la migración: fecha(AAAA-MM-DD),cliente_id,monto,referencia,metodo,nota,llave */
export function parseLegacyPayments(text: string): { rows: LegacyPaymentRow[]; errors: string[] } {
  const rows: LegacyPaymentRow[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  for (const [i, line] of lines.entries()) {
    if (i === 0 && /^fecha/i.test(line)) continue;
    const c = line.split("\t");
    const [date, publicId, amount, reference, method, note, key] = c;
    const amt = Number(amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !publicId || !(amt > 0) || !key) {
      if (errors.length < 30) errors.push(`Renglón ${i + 1}`);
      continue;
    }
    rows.push({ date, publicId: publicId.trim().toLowerCase(), amount: amt, reference: (reference ?? "").slice(0, 120), method: method === "MERCADOPAGO" ? "MERCADOPAGO" : method === "OTHER" ? "OTHER" : "TRANSFER", note: (note ?? "").slice(0, 500), key: key.slice(0, 80) });
  }
  return { rows, errors };
}

export async function importLegacyPayments(prisma: PrismaClient, rows: LegacyPaymentRow[], actorUserId: string) {
  const clients = new Map((await prisma.client.findMany({ select: { id: true, publicId: true } })).map((c) => [c.publicId.toLowerCase(), c.id]));
  const unknown = new Set<string>();
  const data = rows.flatMap((r) => {
    const clientId = clients.get(r.publicId);
    if (!clientId) {
      unknown.add(r.publicId);
      return [];
    }
    return [{
      clientId,
      method: r.method,
      source: "IMPORT" as const,
      status: "APPLIED" as const,
      amount: r.amount,
      reference: r.reference || null,
      receivedAt: new Date(`${r.date}T12:00:00-06:00`),
      externalId: `legacy-pay:${r.key}`,
      note: r.note || "Sistema anterior",
    }];
  });
  let added = 0;
  for (let i = 0; i < data.length; i += 500) added += (await prisma.payment.createMany({ data: data.slice(i, i + 500), skipDuplicates: true })).count;
  await audit(prisma, { actorUserId, action: "migration.payments", entity: "Payment", summary: `Migración: ${added} pagos históricos importados (${data.length - added} ya estaban, ${unknown.size} clientes no encontrados)` });
  return { added, duplicates: data.length - added, unknownClients: [...unknown].sort() };
}

// ── Historial de envíos (sin cargos ni avisos) ──

export type LegacyOrderRow = {
  shipment: string; createdAt: string; mlNick: string; clientName: string; status: string; closedAt: string; carrierId: string;
  recipient: string; phone: string; address: string; city: string; state: string; zip: string; lat: string; lng: string;
  mlOrder: string; packId: string; mlStatus: string; mlSub: string; attempts: string; note: string;
};
const ORDER_COLS: (keyof LegacyOrderRow)[] = ["shipment", "createdAt", "mlNick", "clientName", "status", "closedAt", "carrierId", "recipient", "phone", "address", "city", "state", "zip", "lat", "lng", "mlOrder", "packId", "mlStatus", "mlSub", "attempts", "note"];
const FINAL_EVENT: Record<string, string> = { DELIVERED: "delivered", CANCELLED: "cancelled", RETURNED_TO_SELLER: "returned_to_seller", RETURNED_TO_WAREHOUSE: "return_received", OUT_FOR_DELIVERY: "scanned_loaded" };
const STATUSES = new Set(["DELIVERED", "CANCELLED", "RETURNED_TO_SELLER", "RETURNED_TO_WAREHOUSE", "OUT_FOR_DELIVERY", "FAILED", "CREATED"]);

/** TSV propio de la migración, columnas en el orden de ORDER_COLS (con encabezado). */
export function parseLegacyOrders(text: string): { rows: LegacyOrderRow[]; errors: string[] } {
  const rows: LegacyOrderRow[] = [];
  const errors: string[] = [];
  for (const [i, line] of text.replace(/^﻿/, "").split(/\r?\n/).entries()) {
    if (!line.trim() || (i === 0 && line.startsWith("shipment"))) continue;
    const c = line.split("\t");
    const r = Object.fromEntries(ORDER_COLS.map((k, j) => [k, (c[j] ?? "").trim()])) as LegacyOrderRow;
    if (!/^\d{10,13}$/.test(r.shipment) || Number.isNaN(Date.parse(r.createdAt)) || !STATUSES.has(r.status)) {
      if (errors.length < 30) errors.push(`Renglón ${i + 1}: ${r.shipment || "sin envío"}`);
      continue;
    }
    rows.push(r);
  }
  return { rows, errors };
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const numOrNull = (s: string) => (s && Number.isFinite(Number(s)) && Number(s) !== 0 ? Number(s) : null);
const bigOrNull = (s: string) => (/^\d{6,20}$/.test(s) ? BigInt(s) : null);
const txt = (s: string, n = 300) => (s && s !== "-" ? s.slice(0, n) : null);

export async function importLegacyOrders(prisma: PrismaClient, rows: LegacyOrderRow[], actorUserId: string) {
  const [accounts, clients, drivers] = await Promise.all([
    prisma.mlAccount.findMany({ select: { id: true, nickname: true, clientId: true, mlUserId: true } }),
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.driver.findMany({ where: { legacyCarrierId: { not: null } }, select: { id: true, legacyCarrierId: true } }),
  ]);
  const byNick = new Map(accounts.map((a) => [norm(a.nickname), a]));
  const bySeller = new Map(accounts.map((a) => [a.mlUserId.toString(), a]));
  const byName = new Map(clients.map((c) => [norm(c.name), c.id]));
  const nameOf = (s: string) => {
    const full = norm(s);
    const head = norm(s.split(/\s+-\s+/)[0] ?? "");
    return byName.get(full) ?? byName.get(head) ?? clients.find((c) => norm(c.name).length >= 4 && (full.startsWith(norm(c.name)) || norm(c.name).startsWith(head)))?.id;
  };
  const byCarrier = new Map(drivers.map((d) => [String(d.legacyCarrierId), d.id]));
  const unknown = new Map<string, number>();
  const existing = new Map(
    (await prisma.order.findMany({ where: { mlShipmentId: { in: rows.map((r) => BigInt(r.shipment)) } }, select: { id: true, mlShipmentId: true, source: true } })).map((o) => [o.mlShipmentId!.toString(), o]),
  );
  const creates: Prisma.OrderCreateManyInput[] = [];
  const events: Prisma.OrderEventCreateManyInput[] = [];
  let updated = 0, skippedLive = 0;
  for (const r of rows) {
    const seller = /\((\d+)\)\s*$/.exec(r.mlNick)?.[1];
    const acc = (seller ? bySeller.get(seller) : undefined) ?? byNick.get(norm(r.mlNick.replace(/\s*\(\d+\)\s*$/, "")));
    const clientId = acc?.clientId ?? nameOf(r.clientName);
    if (!clientId) {
      const k = `${r.mlNick || "(sin cuenta ML)"} · ${r.clientName || "(sin cliente Shipday)"}`;
      unknown.set(k, (unknown.get(k) ?? 0) + 1);
      continue;
    }
    const final = r.status !== "OUT_FOR_DELIVERY" && r.status !== "CREATED";
    const createdAt = new Date(r.createdAt);
    const closedAt = r.closedAt && !Number.isNaN(Date.parse(r.closedAt)) ? new Date(r.closedAt) : null;
    const data = {
      status: r.status as Prisma.OrderCreateManyInput["status"],
      mlStatus: txt(r.mlStatus, 40),
      mlSubstatus: txt(r.mlSub, 60),
      attempts: Math.max(0, Math.min(20, Number(r.attempts) || 0)),
      deliveredAt: r.status === "DELIVERED" ? (closedAt ?? createdAt) : null,
      driverId: final ? (byCarrier.get(r.carrierId) ?? null) : null,
    };
    const prev = existing.get(r.shipment);
    if (prev) {
      if (prev.source !== "IMPORT") {
        skippedLive++;
        continue;
      }
      await prisma.order.update({ where: { id: prev.id }, data });
      updated++;
      continue;
    }
    const id = `imp_${r.shipment}`;
    creates.push({
      id,
      code: `ML-${r.shipment}`,
      source: "IMPORT",
      clientId,
      mlAccountId: acc?.id ?? null,
      mlShipmentId: BigInt(r.shipment),
      mlOrderId: bigOrNull(r.mlOrder),
      mlPackId: bigOrNull(r.packId),
      recipientName: txt(r.recipient, 160),
      recipientPhone: r.phone && !/^X+$/i.test(r.phone) && r.phone !== "-" ? r.phone.slice(0, 30) : null,
      addressLine: txt(r.address, 300) ?? "(sin dirección en el sistema anterior)",
      city: txt(r.city, 120),
      state: txt(r.state, 120),
      zip: /^\d{5}$/.test(r.zip) ? r.zip : null,
      lat: numOrNull(r.lat),
      lng: numOrNull(r.lng),
      instructions: txt(r.note, 500),
      createdAt,
      ...data,
    });
    events.push({ orderId: id, type: "created", source: "IMPORT", toStatus: "CREATED", occurredAt: createdAt, note: "Sistema anterior" });
    const ev = FINAL_EVENT[r.status];
    if (ev) events.push({ orderId: id, type: ev, source: "IMPORT", fromStatus: "CREATED", toStatus: data.status, occurredAt: closedAt ?? createdAt });
  }
  let created = 0;
  for (let i = 0; i < creates.length; i += 1000) created += (await prisma.order.createMany({ data: creates.slice(i, i + 1000), skipDuplicates: true })).count;
  // Solo eventos de pedidos que sí quedaron (por si alguno chocó con un código existente).
  const ids = new Set((await prisma.order.findMany({ where: { id: { in: creates.map((c) => c.id!) } }, select: { id: true } })).map((o) => o.id));
  const evs = events.filter((e) => ids.has(e.orderId));
  for (let i = 0; i < evs.length; i += 2000) await prisma.orderEvent.createMany({ data: evs.slice(i, i + 2000) });
  await audit(prisma, { actorUserId, action: "migration.orders", entity: "Order", summary: `Migración: ${created} envíos históricos creados, ${updated} actualizados, ${skippedLive} ya existían en la plataforma nueva` });
  return { created, updated, skippedLive, unknownAccounts: [...unknown.entries()].sort((a, b) => b[1] - a[1]) };
}
