// Conexión con la API de MercadoLibre [I01, I02, A01, A12].
// - OAuth por cuenta de vendedor: el cliente autoriza con su cuenta ML y guardamos los tokens cifrados.
// - Al escanear (o al llegar una notificación) se trae el envío: destinatario, dirección, pin y estado ML.
// Todo lo de red pasa por `fetchImpl` para poder probarlo sin internet.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { adminUserIds, sendPush } from "./push.ts";
import { addOrderEvent, audit } from "./orders.ts";
import { captureShipment } from "./ml-flex.ts";
import { currentFlexDriver, recordFlexAssignment } from "./flex-drivers.ts";

type Db = PrismaClient | Prisma.TransactionClient;
type Fetch = typeof fetch;
const API = "https://api.mercadolibre.com";
export const ML_PENDING_ADDRESS = "Pendiente de sincronizar con MercadoLibre";

export function mlConfig() {
  const clientId = process.env.ML_CLIENT_ID?.trim();
  const clientSecret = process.env.ML_CLIENT_SECRET?.trim();
  const base = process.env.PUBLIC_URL?.trim().replace(/\/$/, "");
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/api/ml/callback` };
}

// ── Estado firmado del OAuth: a qué cliente se liga la cuenta y hasta cuándo vale el enlace ──
function stateSig(payload: string) {
  const k = process.env.ENCRYPTION_KEY?.trim();
  if (!k) throw new Error("Falta ENCRYPTION_KEY");
  return createHmac("sha256", `ml-state:${k}`).update(payload).digest("base64url").slice(0, 22);
}
export function signMlState(clientId: string, days = 7, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ c: clientId, e: now + days * 86_400_000 })).toString("base64url");
  return `${payload}.${stateSig(payload)}`;
}
export function readMlState(state: string, now = Date.now()): string | null {
  const [payload, s] = state.split(".");
  if (!payload || !s) return null;
  const a = Buffer.from(stateSig(payload)), b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { c, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { c: string; e: number };
    return typeof c === "string" && e > now ? c : null;
  } catch {
    return null;
  }
}
export function mlAuthUrl(clientIdOrState: { state: string }) {
  const cfg = mlConfig();
  if (!cfg) return null;
  const u = new URL("https://auth.mercadolibre.com.mx/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", clientIdOrState.state);
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; user_id: number };

export async function tokenRequest(body: Record<string, string>, fetchImpl: Fetch): Promise<TokenResponse> {
  const res = await fetchImpl(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; message?: string };
  if (!res.ok || !j.access_token) {
    const err = new Error(j.message || j.error || `MercadoLibre respondió ${res.status}`);
    (err as Error & { code?: string }).code = j.error;
    throw err;
  }
  return j as TokenResponse;
}

/** Callback del OAuth: cambia el código por tokens y liga la cuenta al cliente del estado. */
export async function connectMlAccount(prisma: PrismaClient, input: { code: string; state: string }, fetchImpl: Fetch = fetch) {
  const cfg = mlConfig();
  if (!cfg) return { ok: false as const, error: "La conexión con MercadoLibre aún no está configurada" };
  const clientId = readMlState(input.state);
  if (!clientId) return { ok: false as const, error: "El enlace venció o no es válido; pide uno nuevo a Packatelas" };
  const client = await prisma.client.findUnique({ where: { id: clientId }, include: { branches: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
  if (!client) return { ok: false as const, error: "Cliente no encontrado" };

  const t = await tokenRequest({ grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.clientSecret, code: input.code, redirect_uri: cfg.redirectUri }, fetchImpl);
  const me = (await (await fetchImpl(`${API}/users/me`, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(15_000) })).json().catch(() => ({}))) as { nickname?: string };
  const mlUserId = BigInt(t.user_id);
  const existing = await prisma.mlAccount.findUnique({ where: { mlUserId }, include: { client: { select: { id: true, publicId: true, name: true } } } });
  // La cuenta ya estaba registrada con otro cliente (p. ej. migrada del sistema anterior): quien
  // inició sesión en MercadoLibre es su dueño, así que se guarda la autorización donde está y se
  // avisa a administración por si hay que moverla. Nunca se mueve sola de cliente.
  const elsewhere = existing && existing.clientId !== client.id ? existing.client : null;
  const tokens = {
    accessTokenEnc: encryptSecret(t.access_token),
    refreshTokenEnc: t.refresh_token ? encryptSecret(t.refresh_token) : null,
    tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
    status: "ACTIVE" as const,
    connectedAt: new Date(),
  };
  const nickname = me.nickname || existing?.nickname || `Vendedor ${t.user_id}`;
  const acc = existing
    ? await prisma.mlAccount.update({ where: { id: existing.id }, data: { ...tokens, nickname } })
    : await prisma.mlAccount.create({
        data: { mlUserId, nickname, clientId: client.id, ...tokens, routes: client.branches[0] ? { create: { branchId: client.branches[0].id, isDefault: true } } : undefined },
      });
  await audit(prisma, {
    action: "ml_account.authorized",
    entity: "MlAccount",
    entityId: acc.id,
    summary: elsewhere ? `Cuenta ML ${nickname} autorizada desde ${client.name}; sigue ligada a ${elsewhere.name} (${elsewhere.publicId})` : `Cuenta ML ${nickname} autorizada por ${client.name}`,
  });
  if (elsewhere) {
    void sendPush(prisma, await adminUserIds(prisma), {
      title: "Cuenta ML en otro cliente",
      body: `${nickname} se autorizó desde ${client.name}, pero está ligada a ${elsewhere.name} (${elsewhere.publicId}). Muévela si corresponde.`,
      url: `/admin/clientes/${elsewhere.id}`,
    });
  }
  // Los envíos de esta cuenta que esperaban datos se vuelven a intentar.
  const waiting = await prisma.order.findMany({ where: { mlAccountId: acc.id, addressLine: ML_PENDING_ADDRESS, mlShipmentId: { not: null } }, select: { mlShipmentId: true }, take: 500 });
  for (const o of waiting) await enqueueMlJob(prisma, { topic: "shipments", resource: `/shipments/${o.mlShipmentId}`, mlUserId });
  return { ok: true as const, nickname, clientName: elsewhere?.name ?? client.name, elsewhere: elsewhere ? { publicId: elsewhere.publicId, name: elsewhere.name } : null };
}

/** Token vigente de la cuenta; lo renueva si vence en menos de 5 minutos. */
export async function mlAccessToken(prisma: PrismaClient, accountId: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const acc = await prisma.mlAccount.findUnique({ where: { id: accountId } });
  if (!acc?.accessTokenEnc || acc.status === "REVOKED" || acc.status === "DISABLED") return null;
  if (acc.tokenExpiresAt && acc.tokenExpiresAt.getTime() - Date.now() > 300_000) return decryptSecret(acc.accessTokenEnc);
  const cfg = mlConfig();
  if (!cfg || !acc.refreshTokenEnc) return null;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: decryptSecret(acc.refreshTokenEnc) }, fetchImpl);
    await prisma.mlAccount.update({
      where: { id: acc.id },
      data: {
        accessTokenEnc: encryptSecret(t.access_token),
        ...(t.refresh_token ? { refreshTokenEnc: encryptSecret(t.refresh_token) } : {}),
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        status: "ACTIVE",
      },
    });
    return t.access_token;
  } catch (e) {
    if ((e as { code?: string }).code === "invalid_grant") await prisma.mlAccount.update({ where: { id: acc.id }, data: { status: "REVOKED" } });
    else await prisma.mlAccount.update({ where: { id: acc.id }, data: { status: "TOKEN_EXPIRED" } });
    throw e;
  }
}

// ── Envíos ──
type Named = { name?: string | null } | string | null | undefined;
const nm = (v: Named) => (typeof v === "string" ? v : v?.name ?? null) || null;

/** Convierte la respuesta de /shipments (formato nuevo o anterior) en campos del pedido. Pura, sin red. */
export function mapMlShipment(j: Record<string, unknown>) {
  const dest = (j.destination ?? {}) as Record<string, unknown>;
  const a = ((dest.shipping_address ?? j.receiver_address ?? {}) as Record<string, unknown>);
  const street = [a.street_name, a.street_number].filter(Boolean).join(" ");
  const addressLine = (a.address_line as string) || street || null;
  const lat = Number(a.latitude), lng = Number(a.longitude);
  const comment = (a.comment as string) || null;
  return {
    recipientName: ((dest.receiver_name ?? a.receiver_name) as string) || null,
    recipientPhone: ((dest.receiver_phone ?? a.receiver_phone) as string) || null,
    addressLine,
    neighborhood: nm(a.neighborhood as Named),
    city: nm(a.city as Named),
    state: nm(a.state as Named),
    zip: (a.zip_code as string) || null,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
    instructions: comment,
    mlStatus: (j.status as string) || null,
    mlSubstatus: (j.substatus as string) || null,
    mlOrderId: j.order_id != null ? BigInt(String(j.order_id)) : (j.external_reference && /^\d+$/.test(String(j.external_reference)) ? BigInt(String(j.external_reference)) : null),
  };
}

/** Trae el envío de ML y completa el pedido. */
export async function syncMlShipment(prisma: PrismaClient, shipmentId: bigint, fetchImpl: Fetch = fetch) {
  const order = await prisma.order.findUnique({ where: { mlShipmentId: shipmentId }, include: { mlAccount: true } });
  if (!order) return { status: "no_order" as const };
  if (!order.mlAccountId) return { status: "no_account" as const };
  const token = await mlAccessToken(prisma, order.mlAccountId, fetchImpl);
  if (!token) return { status: "unauthorized" as const };
  const res = await fetchImpl(`${API}/shipments/${shipmentId}`, { headers: { Authorization: `Bearer ${token}`, "x-format-new": "true" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) {
    await prisma.mlAccount.update({ where: { id: order.mlAccountId }, data: { status: "TOKEN_EXPIRED" } });
    return { status: "unauthorized" as const };
  }
  if (!res.ok) throw new Error(`MercadoLibre respondió ${res.status} al pedir el envío`);
  const m = mapMlShipment((await res.json()) as Record<string, unknown>);
  // Cambio de estado en ML → historial del pedido.
  if (m.mlStatus && (m.mlStatus !== order.mlStatus || (m.mlSubstatus ?? null) !== (order.mlSubstatus ?? null))) {
    await addOrderEvent(prisma, {
      orderId: order.id,
      type: "ml_status",
      source: "ML_SYNC",
      note: mlStatusText(m.mlStatus, m.mlSubstatus),
      data: { status: m.mlStatus, substatus: m.mlSubstatus, previous: order.mlStatus ?? null },
    }).catch(() => {});
  }
  let itemsSummary: string | null = null;
  try {
    const ir = await fetchImpl(`${API}/shipments/${shipmentId}/items`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (ir.ok) {
      const items = (await ir.json()) as { description?: string; quantity?: number }[];
      itemsSummary = items.map((i) => `${i.quantity ?? 1}× ${i.description ?? "artículo"}`).join(", ").slice(0, 300) || null;
    }
  } catch { /* los artículos son opcionales */ }
  await prisma.order.update({
    where: { id: order.id },
    data: {
      ...(m.addressLine ? { addressLine: m.addressLine } : {}),
      // No pisar un pin que ya movió el despacho a mano.
      ...(order.lat == null && m.lat != null ? { lat: m.lat, lng: m.lng } : {}),
      recipientName: m.recipientName ?? order.recipientName,
      recipientPhone: m.recipientPhone ?? order.recipientPhone,
      neighborhood: m.neighborhood ?? order.neighborhood,
      city: m.city ?? order.city,
      state: m.state ?? order.state,
      zip: m.zip ?? order.zip,
      instructions: order.instructions ?? m.instructions,
      mlStatus: m.mlStatus,
      mlSubstatus: m.mlSubstatus,
      mlOrderId: order.mlOrderId ?? m.mlOrderId,
      itemsSummary: order.itemsSummary ?? itemsSummary,
    },
  });
  return { status: "synced" as const };
}

const ML_STATUS_ES: Record<string, string> = {
  pending: "pendiente", handling: "en preparación", ready_to_ship: "listo para enviar", shipped: "en camino",
  delivered: "entregado", not_delivered: "no entregado", cancelled: "cancelado",
};
const ML_SUB_ES: Record<string, string> = {
  ready_to_print: "etiqueta sin imprimir", printed: "etiqueta impresa", out_for_delivery: "salió a reparto", picked_up: "recolectado",
  receiver_absent: "destinatario ausente", returning_to_sender: "regresando al vendedor", delayed: "demorado", soon_deliver: "por entregar",
};
export function mlStatusText(status: string, sub: string | null) {
  const st = ML_STATUS_ES[status] ?? status;
  return sub ? `${st} · ${ML_SUB_ES[sub] ?? sub}` : st;
}

// ── Cola de trabajos ──
export async function enqueueMlJob(db: Db, j: { topic: string; resource: string; mlUserId?: bigint | null }) {
  const id = j.resource.match(/^\/shipments\/(\d+)/)?.[1];
  if (j.topic === "shipments" && !id) return;
  const key = id ? `shipment:${id}` : `${j.topic}:${j.resource}`.slice(0, 200);
  await db.mlJob.upsert({
    where: { key },
    create: { key, topic: j.topic, resource: j.resource.slice(0, 200), mlUserId: j.mlUserId ?? null },
    update: { status: "PENDING", attempts: 0, runAfter: new Date(), lastError: null },
  });
}

/** Procesa trabajos pendientes. Reintenta con espera creciente; tras 6 intentos queda FAILED. */
export async function processMlJobs(prisma: PrismaClient, limit = 25, fetchImpl: Fetch = fetch) {
  const jobs = await prisma.mlJob.findMany({ where: { status: "PENDING", runAfter: { lte: new Date() } }, orderBy: { runAfter: "asc" }, take: limit });
  let done = 0, failed = 0;
  for (const job of jobs) {
    try {
      const id = job.resource.match(/^\/shipments\/(\d+)/)?.[1];
      if (job.topic !== "shipments" || !id) {
        await prisma.mlJob.update({ where: { id: job.id }, data: { status: "DONE", lastError: "Tema no usado" } });
        continue;
      }
      const r = await syncMlShipment(prisma, BigInt(id), fetchImpl);
      if (r.status === "unauthorized") throw new Error("La cuenta ML no ha autorizado a Packatelas");
      // Driver Flex asignado → historial del pedido.
      const ord = await prisma.order.findUnique({ where: { mlShipmentId: BigInt(id) }, select: { id: true, mlAccountId: true } });
      if (ord) {
        const d = await currentFlexDriver(prisma, BigInt(id), ord.mlAccountId, fetchImpl).catch(() => null);
        if (d) await recordFlexAssignment(prisma, ord.id, d).catch(() => false);
      }
      // Envío de una cuenta conocida que aún no escaneamos: va a Recuperados si es Flex.
      if (job.mlUserId) {
        const acc = await prisma.mlAccount.findUnique({ where: { mlUserId: job.mlUserId }, select: { id: true } });
        if (acc) await captureShipment(prisma, acc.id, BigInt(id), fetchImpl);
      }
      await prisma.mlJob.update({ where: { id: job.id }, data: { status: "DONE", lastError: r.status === "synced" ? null : r.status } });
      done++;
    } catch (e) {
      const attempts = job.attempts + 1;
      await prisma.mlJob.update({
        where: { id: job.id },
        data: { attempts, lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300), status: attempts >= 6 ? "FAILED" : "PENDING", runAfter: new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000) },
      });
      failed++;
    }
  }
  return { done, failed, seen: jobs.length };
}
