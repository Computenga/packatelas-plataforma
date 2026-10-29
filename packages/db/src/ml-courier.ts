// Packatelas como Mensajería Flex ante MercadoLibre (modelo nuevo, oct 2026): la mensajería reporta
// a ML los envíos Flex que lleva con
//   POST /flex/sites/MLM/users/{USER_ID_MENSAJERIA}/courier-shipment/v1   {"shipment_id": …}
// usando el token de SU cuenta de ML (no el del vendedor ni el de la app). La cuenta de la
// mensajería se autoriza una vez con el mismo OAuth de la app y se guarda cifrada.
// Envío automático: solo con el interruptor encendido; mientras está apagado no se encola nada.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { mlConfig, signMlState, tokenRequest } from "./ml-api.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;
type Fetch = typeof fetch;
const API = "https://api.mercadolibre.com";
const SETTINGS = "ml.courier.settings";
const ACCOUNT = "ml.courier.account";
/** Prefijo del estado del OAuth para distinguirlo de la conexión de cuentas de vendedores. */
export const COURIER_STATE_PREFIX = "mensajeria:";

export type CourierSettings = { enabled: boolean; expectedUserId: string | null; site: string; enabledAt?: string | null };
type CourierAccount = { userId: string; nickname: string; email?: string | null; accessTokenEnc: string; refreshTokenEnc: string | null; expiresAt: string; connectedAt: string; status: "ACTIVE" | "TOKEN_EXPIRED" | "REVOKED" };

const DEFAULTS: CourierSettings = { enabled: false, expectedUserId: "97333751", site: "MLM", enabledAt: null };

export async function getCourierSettings(db: Db): Promise<CourierSettings> {
  const r = await db.setting.findUnique({ where: { key: SETTINGS } });
  return { ...DEFAULTS, ...((r?.value as Partial<CourierSettings> | undefined) ?? {}) };
}

export async function saveCourierSettings(db: Db, patch: Partial<CourierSettings>, actorUserId: string) {
  const cur = await getCourierSettings(db);
  const next: CourierSettings = { ...cur, ...patch };
  if (patch.enabled && !cur.enabled) next.enabledAt = new Date().toISOString();
  if (next.expectedUserId && !/^\d{4,15}$/.test(next.expectedUserId)) throw new Error("ID de cuenta inválido");
  await db.setting.upsert({ where: { key: SETTINGS }, update: { value: next }, create: { key: SETTINGS, value: next } });
  await audit(db, { actorUserId, action: "ml_courier.settings", entity: "Setting", entityId: SETTINGS, summary: `Reporte a ML como mensajería ${next.enabled ? "ENCENDIDO" : "apagado"} (cuenta ${next.expectedUserId ?? "—"})` });
  return next;
}

/** Cuenta de ML de la mensajería (sin tokens). */
export async function courierAccount(db: Db) {
  const r = await db.setting.findUnique({ where: { key: ACCOUNT } });
  const a = r?.value as CourierAccount | undefined;
  return a ? { userId: a.userId, nickname: a.nickname, email: a.email ?? null, connectedAt: a.connectedAt, expiresAt: a.expiresAt, status: a.status } : null;
}

/** Enlace para que la mensajería autorice a Packatelas (vale 2 días). */
export function courierAuthUrl(actorUserId: string) {
  const cfg = mlConfig();
  if (!cfg) return null;
  const u = new URL("https://auth.mercadolibre.com.mx/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", signMlState(`${COURIER_STATE_PREFIX}${actorUserId}`, 2));
  return u.toString();
}

/** Callback del OAuth de la mensajería. Rechaza si quien autorizó no es la cuenta esperada. */
export async function connectCourier(prisma: PrismaClient, code: string, actorUserId: string | null, fetchImpl: Fetch = fetch) {
  const cfg = mlConfig();
  if (!cfg) return { ok: false as const, error: "La conexión con MercadoLibre aún no está configurada" };
  const t = await tokenRequest({ grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri }, fetchImpl);
  const me = (await (await fetchImpl(`${API}/users/me`, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(15_000) })).json().catch(() => ({}))) as { nickname?: string; email?: string };
  const s = await getCourierSettings(prisma);
  if (s.expectedUserId && String(t.user_id) !== s.expectedUserId) {
    return { ok: false as const, error: `Iniciaste sesión con la cuenta ${me.nickname ?? t.user_id} (ID ${t.user_id}); debe ser la cuenta de la mensajería (ID ${s.expectedUserId}). Cierra sesión en MercadoLibre y vuelve a abrir el enlace.` };
  }
  const value: CourierAccount = {
    userId: String(t.user_id),
    nickname: me.nickname ?? `Cuenta ${t.user_id}`,
    email: me.email ?? null,
    accessTokenEnc: encryptSecret(t.access_token),
    refreshTokenEnc: t.refresh_token ? encryptSecret(t.refresh_token) : null,
    expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    connectedAt: new Date().toISOString(),
    status: "ACTIVE",
  };
  await prisma.setting.upsert({ where: { key: ACCOUNT }, update: { value }, create: { key: ACCOUNT, value } });
  await audit(prisma, { actorUserId: actorUserId ?? undefined, action: "ml_courier.authorized", entity: "Setting", entityId: ACCOUNT, summary: `Cuenta de mensajería ML autorizada: ${value.nickname} (${value.userId})` });
  return { ok: true as const, nickname: value.nickname, userId: value.userId };
}

export async function courierToken(prisma: PrismaClient, fetchImpl: Fetch = fetch) {
  const r = await prisma.setting.findUnique({ where: { key: ACCOUNT } });
  const a = r?.value as CourierAccount | undefined;
  if (!a || a.status === "REVOKED") return null;
  if (new Date(a.expiresAt).getTime() - Date.now() > 300_000) return { token: decryptSecret(a.accessTokenEnc), userId: a.userId };
  const cfg = mlConfig();
  if (!cfg || !a.refreshTokenEnc) return null;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: decryptSecret(a.refreshTokenEnc) }, fetchImpl);
    const value: CourierAccount = { ...a, accessTokenEnc: encryptSecret(t.access_token), refreshTokenEnc: t.refresh_token ? encryptSecret(t.refresh_token) : a.refreshTokenEnc, expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(), status: "ACTIVE" };
    await prisma.setting.update({ where: { key: ACCOUNT }, data: { value } });
    return { token: t.access_token, userId: a.userId };
  } catch (e) {
    await prisma.setting.update({ where: { key: ACCOUNT }, data: { value: { ...a, status: (e as { code?: string }).code === "invalid_grant" ? "REVOKED" : "TOKEN_EXPIRED" } } });
    throw e;
  }
}

/** Envía un envío a ML. Guarda la respuesta tal cual (recortada) para revisión. */
export async function sendCourierReport(prisma: PrismaClient, shipmentId: bigint, opts: { source?: string; actorUserId?: string; fetchImpl?: Fetch } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const s = await getCourierSettings(prisma);
  const row = await prisma.mlCourierReport.upsert({
    where: { shipmentId },
    create: { shipmentId, source: opts.source ?? "scan", createdById: opts.actorUserId },
    update: {},
  });
  if (row.status === "SENT") return { status: "already" as const, row };
  const tk = await courierToken(prisma, fetchImpl).catch(() => null);
  if (!tk) {
    const r = await prisma.mlCourierReport.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError: "La cuenta de mensajería no está autorizada", runAfter: new Date(Date.now() + 15 * 60_000) } });
    return { status: "unauthorized" as const, row: r };
  }
  const res = await fetchImpl(`${API}/flex/sites/${s.site}/users/${tk.userId}/courier-shipment/v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tk.token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ shipment_id: Number(shipmentId) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.text().catch(() => "")).slice(0, 1000);
  const attempts = row.attempts + 1;
  // 4xx (salvo 429) no se arregla reintentando: queda como FAILED para revisarlo.
  const retry = res.status === 429 || res.status >= 500;
  const r = await prisma.mlCourierReport.update({
    where: { id: row.id },
    data: res.ok
      ? { status: "SENT", attempts, httpStatus: res.status, response: body, lastError: null, sentAt: new Date() }
      : { status: retry && attempts < 8 ? "PENDING" : "FAILED", attempts, httpStatus: res.status, response: body, lastError: `HTTP ${res.status}`, runAfter: new Date(Date.now() + Math.min(3600, 60 * 2 ** attempts) * 1000) },
  });
  await audit(prisma, { actorUserId: opts.actorUserId, action: "ml_courier.report", entity: "MlCourierReport", entityId: r.id, summary: `Reporte a ML del envío ${shipmentId}: HTTP ${res.status}` }).catch(() => {});
  return { status: res.ok ? ("sent" as const) : ("error" as const), httpStatus: res.status, body, row: r };
}

/** Al escanear un envío ML: se encola su reporte, solo si el envío automático está encendido. */
export async function enqueueCourierReport(db: Db, shipmentId: bigint) {
  const s = await getCourierSettings(db);
  if (!s.enabled) return false;
  await db.mlCourierReport.upsert({ where: { shipmentId }, create: { shipmentId, source: "scan" }, update: {} });
  return true;
}

/** Proceso del worker: manda los pendientes (solo con el interruptor encendido). */
export async function processCourierReports(prisma: PrismaClient, limit = 30, fetchImpl: Fetch = fetch) {
  const s = await getCourierSettings(prisma);
  if (!s.enabled) return { sent: 0, failed: 0, seen: 0 };
  const rows = await prisma.mlCourierReport.findMany({ where: { status: "PENDING", runAfter: { lte: new Date() } }, orderBy: { runAfter: "asc" }, take: limit });
  let sent = 0, failed = 0;
  for (const r of rows) {
    const x = await sendCourierReport(prisma, r.shipmentId, { fetchImpl }).catch(() => null);
    if (x?.status === "sent" || x?.status === "already") sent++;
    else failed++;
  }
  return { sent, failed, seen: rows.length };
}
