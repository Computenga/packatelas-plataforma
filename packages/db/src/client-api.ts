// API para clientes grandes [I08]: llaves por cliente, alta y consulta de envíos, y webhooks
// firmados (HMAC-SHA256) cada vez que cambia el estado de un envío.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { Prisma, PrismaClient, OrderStatus } from "../generated/prisma/client.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export const STATUS_TEXT: Record<OrderStatus, string> = {
  CREATED: "Registrado",
  ASSIGNED: "Asignado a repartidor",
  OUT_FOR_DELIVERY: "En camino",
  DELIVERED: "Entregado",
  FAILED: "No entregado",
  RESCHEDULED: "Reprogramado",
  RETURNING: "Regresa a bodega",
  RETURNED_TO_WAREHOUSE: "En bodega",
  RETURNED_TO_SELLER: "Devuelto al vendedor",
  CANCELLED: "Cancelado",
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ——— Llaves ———

export async function createApiKey(prisma: PrismaClient, clientId: string, name: string) {
  const active = await prisma.apiKey.count({ where: { clientId, revokedAt: null } });
  if (active >= 5) throw new Error("Máximo 5 llaves activas; revoca una antes de crear otra");
  const key = `pk_live_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.apiKey.create({
    data: { clientId, name: name.trim().slice(0, 60) || "Llave", prefix: key.slice(0, 12), hash: sha256(key) },
  });
  return { key, id: row.id };
}

export async function revokeApiKey(prisma: PrismaClient, clientId: string, id: string) {
  const r = await prisma.apiKey.updateMany({ where: { id, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count > 0;
}

/** Cliente dueño de la llave, o null si no existe, está revocada o el cliente está inactivo. */
export async function authenticateApiKey(prisma: PrismaClient, raw: string | null | undefined) {
  if (!raw || !raw.startsWith("pk_live_") || raw.length > 100) return null;
  const row = await prisma.apiKey.findUnique({ where: { hash: sha256(raw) }, include: { client: { select: { id: true, active: true, name: true } } } });
  if (!row || row.revokedAt || !row.client.active) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { clientId: row.client.id, clientName: row.client.name, keyId: row.id };
}

// ——— Webhooks ———

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^(22[4-9]|2[3-5]\d)\./];

/** IPv6 → grupos de 16 bits (expande "::" y una IPv4 al final). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const groups = b === null ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  if (groups.length !== 8) return null;
  const n = groups.map((g) => parseInt(g || "0", 16));
  return n.some((x) => Number.isNaN(x) || x > 0xffff) ? null : n;
}

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some((r) => r.test(ip));
  const g = v6Groups(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // IPv4 dentro de IPv6: ::ffff:a.b.c.d, ::a.b.c.d y 64:ff9b::a.b.c.d (NAT64)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return g[6] === 0 && g[7] <= 1 ? true : isPrivateIp(embedded(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIp(embedded(g[6], g[7]));
  if (g.every((x) => x === 0)) return true; // ::
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2002) return isPrivateIp(embedded(g[1], g[2])); // 6to4
  return false;
}

/** Solo HTTPS a un servidor público (evita que la plataforma llame a servicios internos). Devuelve las IPs revisadas. */
export async function assertPublicUrl(raw: string, resolve = lookup) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL inválida");
  }
  if (u.protocol !== "https:") throw new Error("La URL debe empezar con https://");
  if (u.username || u.password) throw new Error("La URL no puede llevar usuario ni contraseña");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || (!host.includes(".") && !isIP(host))) {
    throw new Error("La URL debe ser un servidor público");
  }
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("No se encontró el servidor de la URL");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("La URL debe ser un servidor público");
  return Object.assign(u, { addresses: addrs as { address: string; family: number }[] });
}

/** POST a la IP ya revisada (sin volver a resolver el nombre: evita el "DNS rebinding"). */
function postPinned(u: URL & { addresses: { address: string; family: number }[] }, headers: Record<string, string>, body: string): Promise<number> {
  const pin = u.addresses[0];
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        method: "POST",
        hostname: u.hostname.replace(/^\[|\]$/g, ""),
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        lookup: (_h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) => cb(null, pin.address, pin.family),
        timeout: 10_000,
      } as never,
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Tiempo de espera agotado")));
    req.on("error", reject);
    req.end(body);
  });
}

export async function saveWebhook(prisma: PrismaClient, clientId: string, url: string, resolve = lookup) {
  const u = await assertPublicUrl(url.trim(), resolve);
  const existing = await prisma.webhookEndpoint.findUnique({ where: { clientId } });
  if (existing) return prisma.webhookEndpoint.update({ where: { clientId }, data: { url: u.toString(), active: true } });
  return prisma.webhookEndpoint.create({ data: { clientId, url: u.toString(), secret: encryptSecret(`whsec_${randomBytes(24).toString("base64url")}`) } });
}

export async function rotateWebhookSecret(prisma: PrismaClient, clientId: string) {
  return prisma.webhookEndpoint.update({ where: { clientId }, data: { secret: encryptSecret(`whsec_${randomBytes(24).toString("base64url")}`) } });
}

export async function disableWebhook(prisma: PrismaClient, clientId: string) {
  await prisma.webhookEndpoint.updateMany({ where: { clientId }, data: { active: false } });
}

export const webhookSecret = (enc: string) => decryptSecret(enc);

/** Firma: hex(HMAC-SHA256(secreto, "<timestamp>.<cuerpo>")). */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Se llama al cambiar el estado de un envío (desde addOrderEvent). */
export async function enqueueWebhook(db: Db, orderId: string, from: OrderStatus, to: OrderStatus, at: Date, note?: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { code: true, externalRef: true, client: { select: { webhook: true } } } });
  const ep = order?.client.webhook;
  if (!order || !ep?.active) return;
  const payload = {
    evento: "envio.estado",
    codigo: order.code,
    referencia: order.externalRef,
    estado: to,
    estado_texto: STATUS_TEXT[to],
    estado_anterior: from,
    ocurrio: at.toISOString(),
    // Solo el motivo de no entrega o regreso (como en el portal); nunca notas internas.
    nota: ["FAILED", "RESCHEDULED", "RETURNING"].includes(to) ? (note ?? null) : null,
  };
  await db.webhookDelivery.create({ data: { endpointId: ep.id, orderId, event: "envio.estado", payload } });
}

const MAX_ATTEMPTS = 8;

/** Envía webhooks pendientes; reintenta con espera creciente (1, 2, 4… min, máx. 6 h). */
export async function processWebhooks(prisma: PrismaClient, opts: { fetchImpl?: typeof fetch; resolve?: typeof lookup; limit?: number } = {}) {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    include: { endpoint: true },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 25,
  });
  let sent = 0, failed = 0;
  for (const d of due) {
    const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
    const ts = Math.floor(Date.now() / 1000);
    let code: number | null = null;
    let error: string | null = null;
    try {
      if (!d.endpoint.active) throw new Error("Webhook desactivado");
      const target = await assertPublicUrl(d.endpoint.url, opts.resolve);
      const headers = {
          "Content-Type": "application/json",
          "User-Agent": "Packatelas-Webhooks/1",
          "X-Packatelas-Event": d.event,
          "X-Packatelas-Delivery": d.id,
          "X-Packatelas-Timestamp": String(ts),
          "X-Packatelas-Signature": `sha256=${signWebhook(webhookSecret(d.endpoint.secret), ts, body)}`,
      };
      code = opts.fetchImpl
        ? (await opts.fetchImpl(d.endpoint.url, { method: "POST", redirect: "manual", headers, body, signal: AbortSignal.timeout(10_000) })).status
        : await postPinned(target, headers, body);
      if (code < 200 || code >= 300) error = `Respuesta ${code}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "SENT", attempts, sentAt: new Date(), responseCode: code, lastError: null } });
      sent++;
    } else {
      const giveUp = attempts >= MAX_ATTEMPTS || !d.endpoint.active;
      const wait = Math.min(2 ** (attempts - 1), 360) * 60_000;
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: giveUp ? "FAILED" : "PENDING", attempts, responseCode: code, lastError: error.slice(0, 300), nextAttemptAt: new Date(Date.now() + wait) },
      });
      failed++;
    }
  }
  return { sent, failed };
}

/** Reintentar a mano un webhook fallido (desde el portal). */
export async function retryWebhook(prisma: PrismaClient, clientId: string, id: string) {
  const r = await prisma.webhookDelivery.updateMany({
    where: { id, status: "FAILED", endpoint: { clientId } },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date() },
  });
  return r.count > 0;
}
