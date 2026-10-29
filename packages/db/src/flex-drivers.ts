// Vincular drivers Flex de MercadoLibre con repartidores de Packatelas [A05].
// Flujo: el repartidor escanea un paquete en la app Flex de ML (queda asignado a él); en el panel se
// escanea el QR de ese mismo paquete y se consulta a ML quién lo tiene asignado
//   GET /flex/sites/MLM/shipments/{envío}/assignment/v2  → driver_id
// Se prueba con el token del vendedor dueño del envío y, si no, con el de la mensajería.
// ML responde 404 si no hay driver asignado, si la ruta ya se cerró o si el envío no existe.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { mlAccessToken } from "./ml-api.ts";
import { courierToken } from "./ml-courier.ts";
import { audit } from "./orders.ts";
import { parseScan } from "./scan.ts";

type Fetch = typeof fetch;
const API = "https://api.mercadolibre.com";

/** Busca el id del driver en la respuesta (ML ha cambiado el formato; se aceptan variantes). */
export function driverIdFrom(j: unknown): string | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const direct = o.driver_id ?? (o.driver as Record<string, unknown> | undefined)?.id ?? (o.assignment as Record<string, unknown> | undefined)?.driver_id;
  if (direct != null && /^\d{3,15}$/.test(String(direct))) return String(direct);
  for (const k of ["results", "data", "assignments"]) {
    const arr = o[k];
    if (Array.isArray(arr) && arr.length) {
      const d = driverIdFrom(arr[arr.length - 1]);
      if (d) return d;
    }
  }
  return null;
}

export type FlexLookup =
  | { ok: false; error: string; shipmentId?: string; detail?: string }
  | {
      ok: true;
      shipmentId: string;
      flexDriverId: string;
      nickname: string | null;
      via: "vendedor" | "mensajeria";
      linked: { identityId: string; driverId: string; name: string; username: string } | null;
    };

export async function lookupFlexDriver(prisma: PrismaClient, raw: string, fetchImpl: Fetch = fetch): Promise<FlexLookup> {
  // Acepta el QR de la etiqueta, el número de envío de ML (10–13 dígitos) o el código del pedido.
  const parsed = parseScan(raw);
  let sid: bigint;
  let senderId: bigint | null = null;
  if (parsed.kind === "ML") {
    sid = parsed.shipmentId;
    senderId = parsed.senderId;
  } else if (parsed.kind === "CODE") {
    const o = await prisma.order.findUnique({ where: { code: parsed.code }, select: { mlShipmentId: true } });
    if (!o?.mlShipmentId) return { ok: false, error: `El pedido ${parsed.code} no es un envío de MercadoLibre` };
    sid = o.mlShipmentId;
  } else return { ok: false, error: "Escanea el QR o escribe el número de envío de MercadoLibre" };

  // Token del vendedor: por la cuenta del QR, o por el envío ya registrado.
  const accId =
    (senderId ? (await prisma.mlAccount.findUnique({ where: { mlUserId: senderId }, select: { id: true } }))?.id : null) ??
    (await prisma.order.findUnique({ where: { mlShipmentId: sid }, select: { mlAccountId: true } }))?.mlAccountId ??
    (await prisma.mlFlexShipment.findUnique({ where: { shipmentId: sid }, select: { mlAccountId: true } }))?.mlAccountId ??
    null;
  const tries: { via: "vendedor" | "mensajeria"; token: string }[] = [];
  const sellerToken = accId ? await mlAccessToken(prisma, accId, fetchImpl).catch(() => null) : null;
  if (sellerToken) tries.push({ via: "vendedor", token: sellerToken });
  const courier = await courierToken(prisma, fetchImpl).catch(() => null);
  if (courier) tries.push({ via: "mensajeria", token: courier.token });
  if (!tries.length) return { ok: false, shipmentId: sid.toString(), error: "No hay con qué consultar a ML: la cuenta del vendedor no ha autorizado a Packatelas y la cuenta de mensajería tampoco está autorizada" };

  const errors: string[] = [];
  for (const t of tries) {
    const res = await fetchImpl(`${API}/flex/sites/MLM/shipments/${sid}/assignment/v2`, { headers: { Authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    if (!res.ok) {
      errors.push(`${t.via}: HTTP ${res.status} ${text.slice(0, 150)}`);
      continue;
    }
    let j: unknown = null;
    try {
      j = JSON.parse(text);
    } catch { /* respuesta no JSON */ }
    const flexDriverId = driverIdFrom(j);
    if (!flexDriverId) {
      errors.push(`${t.via}: sin driver asignado (${text.slice(0, 150)})`);
      continue;
    }
    // Apodo del driver (público en ML); si falla no importa.
    const u = await fetchImpl(`${API}/users/${flexDriverId}`, { headers: { Authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ nickname?: string }>) : null))
      .catch(() => null);
    const ident = await prisma.flexIdentity.findUnique({ where: { flexDriverId: BigInt(flexDriverId) }, include: { driver: { include: { user: { select: { name: true, username: true } } } } } });
    return {
      ok: true,
      shipmentId: sid.toString(),
      flexDriverId,
      nickname: u?.nickname ?? null,
      via: t.via,
      linked: ident ? { identityId: ident.id, driverId: ident.driverId, name: ident.driver.user.name, username: ident.driver.user.username } : null,
    };
  }
  const unassigned = errors.every((e) => /sin driver|404/.test(e));
  return {
    ok: false,
    shipmentId: sid.toString(),
    error: unassigned ? "MercadoLibre no tiene un driver Flex con ruta abierta para ese envío. Pide al repartidor que lo escanee en la app Flex de ML (y que no cierre la ruta) y vuelve a buscarlo." : "MercadoLibre no respondió con el driver del envío",
    detail: errors.join(" · ").slice(0, 600),
  };
}

/**
 * Diagnóstico para administradores (solo lectura): estado del envío en ML y respuesta de cada
 * variante del endpoint de asignación, con cada token disponible. No incluye datos del comprador.
 */
export async function diagnoseFlexAssignment(prisma: PrismaClient, shipmentId: string, fetchImpl: Fetch = fetch) {
  if (!/^\d{10,13}$/.test(shipmentId)) return { error: "Número de envío inválido" };
  const sid = BigInt(shipmentId);
  const accId =
    (await prisma.order.findUnique({ where: { mlShipmentId: sid }, select: { mlAccountId: true } }))?.mlAccountId ??
    (await prisma.mlFlexShipment.findUnique({ where: { shipmentId: sid }, select: { mlAccountId: true } }))?.mlAccountId ??
    null;
  const acc = accId ? await prisma.mlAccount.findUnique({ where: { id: accId }, select: { nickname: true, mlUserId: true, status: true } }) : null;
  const tokens: { via: string; token: string }[] = [];
  const st = accId ? await mlAccessToken(prisma, accId, fetchImpl).catch(() => null) : null;
  if (st) tokens.push({ via: "vendedor", token: st });
  const ct = await courierToken(prisma, fetchImpl).catch(() => null);
  if (ct) tokens.push({ via: "mensajeria", token: ct.token });
  const out: Record<string, unknown> = { cuentaVendedor: acc ? { nickname: acc.nickname, id: acc.mlUserId.toString(), status: acc.status } : "no está en Packatelas", mensajeria: ct ? ct.userId : "sin autorizar" };
  const get = async (path: string, token: string) => {
    const r = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, "x-format-new": "true" }, signal: AbortSignal.timeout(15_000) }).catch((e) => e as Error);
    if (r instanceof Error) return { error: r.message };
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 300) };
  };
  for (const t of tokens) {
    const ship = await get(`/shipments/${sid}`, t.token);
    let resumen: unknown = ship;
    try {
      const j = JSON.parse((ship as { body?: string }).body ?? "") as Record<string, unknown>;
      resumen = { status: (ship as { status: number }).status, envio: { status: j.status, substatus: j.substatus, logistic: (j.logistic as { type?: string })?.type ?? j.logistic_type, sender_id: (j.sender_id ?? (j.origin as { sender_id?: number })?.sender_id) } };
    } catch { /* deja la respuesta cruda */ }
    out[`${t.via}.envio`] = resumen;
    for (const path of [`/flex/sites/MLM/shipments/${sid}/assignment/v2`, `/flex/sites/MLM/shipments/${sid}/assignment/v1`, `/flex/sites/MLM/shipments/${sid}/assignment`]) {
      out[`${t.via} ${path.replace(String(sid), "{envío}")}`] = await get(path, t.token);
    }
  }
  return out;
}

/** Vincula (o mueve) un driver Flex a un repartidor de Packatelas. */
export async function linkFlexDriver(prisma: PrismaClient, input: { flexDriverId: string; driverId: string; shipmentId?: string; actorUserId: string }) {
  if (!/^\d{3,15}$/.test(input.flexDriverId)) throw new Error("ID de driver Flex inválido");
  const driver = await prisma.driver.findUnique({ where: { id: input.driverId }, include: { user: { select: { name: true } } } });
  if (!driver) throw new Error("Repartidor no encontrado");
  const flexDriverId = BigInt(input.flexDriverId);
  const prev = await prisma.flexIdentity.findUnique({ where: { flexDriverId }, include: { driver: { include: { user: { select: { name: true } } } } } });
  const shipment = input.shipmentId && /^\d{10,13}$/.test(input.shipmentId) ? BigInt(input.shipmentId) : undefined;
  await prisma.flexIdentity.upsert({
    where: { flexDriverId },
    update: { driverId: driver.id, ...(shipment ? { lastShipmentId: shipment } : {}) },
    create: { flexDriverId, driverId: driver.id, lastShipmentId: shipment },
  });
  await audit(prisma, {
    actorUserId: input.actorUserId,
    action: "flex.linked",
    entity: "Driver",
    entityId: driver.id,
    summary: prev && prev.driverId !== driver.id ? `Driver Flex ${input.flexDriverId} movido de ${prev.driver.user.name} a ${driver.user.name}` : `Driver Flex ${input.flexDriverId} vinculado a ${driver.user.name}`,
  });
  return { name: driver.user.name, moved: !!prev && prev.driverId !== driver.id, previous: prev?.driver.user.name ?? null };
}
