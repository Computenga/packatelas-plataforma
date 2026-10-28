// Envíos Flex de todas las cuentas de MercadoLibre de los clientes [Recuperados] y datos para
// reimprimir la guía. Fuentes: avisos de ML (tema shipments) y un barrido periódico de las ventas
// recientes de cada cuenta. Un envío Flex queda en «Recuperados» hasta que uno de nuestros
// repartidores lo escanea; entonces se liga a su pedido y pasa al histórico.
//
// La guía se regenera con el contenido EXACTO del QR original (JSON con id, sender_id, hash_code y
// security_digit). La API de ML entrega la etiqueta con hash_code en null, así que el QR válido se
// toma de la lectura del escáner (bodega o repartidor) de la etiqueta que imprimió el vendedor.
// Nunca se genera una guía con el hash vacío.
import { inflateRawSync } from "node:zlib";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { mapMlShipment, mlAccessToken } from "./ml-api.ts";

type Db = PrismaClient | Prisma.TransactionClient;
type Fetch = typeof fetch;
const API = "https://api.mercadolibre.com";

/** Estados de ML en los que el paquete todavía no termina su viaje. */
export const FLEX_OPEN_STATUSES = ["pending", "handling", "ready_to_ship", "shipped", "not_delivered"];

// ── QR de la etiqueta ──

/** ¿Es el contenido de un QR de etiqueta ML completo (trae el hash)? */
export function isFullMlQr(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const j = JSON.parse(raw.trim()) as Record<string, unknown>;
    return /^\d{10,13}$/.test(String(j.id ?? "")) && typeof j.hash_code === "string" && j.hash_code.length > 0;
  } catch {
    return false;
  }
}

/** Decodifica los escapes de ^FH (por omisión «_» seguido de dos dígitos hexadecimales). */
function decodeFh(data: string, indicator = "_") {
  const esc = indicator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bytes: number[] = [];
  const re = new RegExp(`${esc}([0-9A-Fa-f]{2})`, "y");
  for (let i = 0; i < data.length; ) {
    re.lastIndex = i;
    const m = re.exec(data);
    if (m) {
      bytes.push(parseInt(m[1], 16));
      i += 3;
    } else {
      for (const b of Buffer.from(data[i], "utf8")) bytes.push(b);
      i++;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Extrae el contenido del QR de una etiqueta ZPL de Mercado Envíos. Devuelve el texto tal cual se
 * codificó (normalmente JSON con hash_code) o null.
 */
export function qrFromZpl(zpl: string): string | null {
  // Cada campo va de ^FO/^FT … hasta ^FS; buscamos el que tiene ^BQ (código QR).
  for (const field of zpl.split(/\^FS/i)) {
    const bq = field.search(/\^BQ/i);
    if (bq < 0) continue;
    const fhMatch = /\^FH(.)?/i.exec(field);
    const fd = field.slice(bq).search(/\^FD/i);
    if (fd < 0) continue;
    let data = field.slice(bq + fd + 3);
    // Prefijo del modo QR: <corrección H|Q|M|L><entrada A|M>, …  p. ej. «LA,» «QA,» «MM,N»
    const mode = /^([HQML])([AM]),/i.exec(data);
    if (mode) data = data.slice(mode[0].length);
    if (/^[HQML]M,/i.test(data)) data = data.slice(3); // modo manual: «MM,» seguido de «N»/«A»…
    if (fhMatch) data = decodeFh(data, fhMatch[1] && fhMatch[1] !== "^" ? fhMatch[1] : "_");
    data = data.trim();
    if (data) return data;
  }
  return null;
}

/** Lee el primer archivo de un ZIP (las etiquetas zpl2 de ML llegan comprimidas). */
export function firstFileFromZip(buf: Buffer): Buffer | null {
  if (buf.readUInt32LE(0) !== 0x04034b50) return null;
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  // Si el tamaño viene en el descriptor posterior (bit 3), se toma hasta el directorio central.
  let end = compSize ? start + compSize : buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), start);
  if (end < 0) end = buf.length;
  const data = buf.subarray(start, end);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  return null;
}

/**
 * Pide la etiqueta ZPL a ML y devuelve el contenido del QR solo si trae hash. Comprobado en
 * producción (oct 2026): las etiquetas por API llegan con hash_code y security_digit en null, así
 * que normalmente devuelve null; se deja por si ML lo cambia. Si el envío no estaba impreso, ML lo
 * marca como impreso.
 */
export async function fetchLabelQr(token: string, shipmentId: bigint, fetchImpl: Fetch = fetch): Promise<string | null> {
  const res = await fetchImpl(`${API}/shipment_labels?shipment_ids=${shipmentId}&response_type=zpl2`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const text = (firstFileFromZip(buf) ?? buf).toString("utf8");
  const qr = qrFromZpl(text);
  return qr && isFullMlQr(qr) ? qr : null;
}

/**
 * Diagnóstico de la etiqueta (solo estructura, sin datos del destinatario): para revisar por qué no
 * se pudo extraer el QR.
 */
export async function diagnoseLabel(prisma: PrismaClient, shipmentId: bigint, fetchImpl: Fetch = fetch) {
  const cap = await prisma.mlFlexShipment.findUnique({ where: { shipmentId }, select: { mlAccountId: true, mlStatus: true, mlSubstatus: true } });
  const ord = cap ? null : await prisma.order.findUnique({ where: { mlShipmentId: shipmentId }, select: { mlAccountId: true } });
  const accountId = cap?.mlAccountId ?? ord?.mlAccountId;
  if (!accountId) return { error: "sin cuenta" };
  const token = await mlAccessToken(prisma, accountId, fetchImpl);
  if (!token) return { error: "sin token" };
  const out: Record<string, unknown> = { mlStatus: cap?.mlStatus, mlSubstatus: cap?.mlSubstatus };
  for (const type of ["zpl2", "pdf"]) {
    const res = await fetchImpl(`${API}/shipment_labels?shipment_ids=${shipmentId}&response_type=${type}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
    const info: Record<string, unknown> = { status: res.status, contentType: res.headers.get("content-type"), bytes: buf.length, zip, head: zip ? "PK" : buf.subarray(0, 4).toString("latin1") };
    if (type === "zpl2") {
      let text = "";
      try {
        text = (zip ? firstFileFromZip(buf) ?? Buffer.alloc(0) : buf).toString("utf8");
      } catch (e) {
        info.unzipError = String(e);
      }
      if (!res.ok) info.body = buf.toString("utf8").slice(0, 300);
      info.zplCommands = [...new Set(text.match(/\^[A-Z][A-Z0-9@]/g) ?? [])].join(" ");
      const i = text.search(/\^BQ/i);
      if (i >= 0) {
        const seg = text.slice(i, i + 400).split(/\^FS/i)[0];
        info.bqField = seg.replace(/[A-Za-z0-9+/=]{12,}/g, (m) => `<${m.length} chars>`).replace(/\d{6,}/g, (m) => `<${m.length} dígitos>`);
      } else info.bq = "no hay ^BQ";
      const qr = qrFromZpl(text);
      info.qrExtraido = qr ? qr.replace(/"([^"]{6,})"/g, (_, v: string) => `"<${v.length}>"`).replace(/\d{6,}/g, (m) => `<${m.length}d>`) : null;
      info.qrConHash = isFullMlQr(qr);
    }
    out[type] = info;
  }
  return out;
}

/** Etiqueta original de ML (PDF o ZPL) tal cual, para revisión del administrador. */
export async function rawMlLabel(prisma: PrismaClient, shipmentId: bigint, type: "pdf" | "zpl2", fetchImpl: Fetch = fetch) {
  const cap = await prisma.mlFlexShipment.findUnique({ where: { shipmentId }, select: { mlAccountId: true } });
  const ord = cap ? null : await prisma.order.findUnique({ where: { mlShipmentId: shipmentId }, select: { mlAccountId: true } });
  const accountId = cap?.mlAccountId ?? ord?.mlAccountId;
  const token = accountId ? await mlAccessToken(prisma, accountId, fetchImpl) : null;
  if (!token) return null;
  const res = await fetchImpl(`${API}/shipment_labels?shipment_ids=${shipmentId}&response_type=${type}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

// ── Captura de envíos ──

type MlJson = Record<string, unknown>;

async function getJson(url: string, token: string, fetchImpl: Fetch, newFormat = false): Promise<MlJson | null> {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, ...(newFormat ? { "x-format-new": "true" } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("La cuenta ML no autoriza a Packatelas"), { code: "unauthorized" });
  if (!res.ok) return null;
  return (await res.json()) as MlJson;
}

/** Tipo logístico del envío (formato nuevo o anterior). */
export function logisticTypeOf(j: MlJson): string | null {
  const l = j.logistic as { type?: string } | undefined;
  return (l?.type ?? (j.logistic_type as string | undefined)) || null;
}

const asDate = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * Trae un envío de la cuenta y lo guarda. Si no es Flex solo se recuerda el tipo para no volver a
 * consultarlo. Devuelve el tipo logístico o null si ML no lo regresó.
 */
export async function captureShipment(prisma: PrismaClient, accountId: string, shipmentId: bigint, fetchImpl: Fetch = fetch) {
  const account = await prisma.mlAccount.findUnique({ where: { id: accountId }, select: { id: true, clientId: true } });
  if (!account) return null;
  const token = await mlAccessToken(prisma, accountId, fetchImpl);
  if (!token) return null;
  const j = await getJson(`${API}/shipments/${shipmentId}`, token, fetchImpl, true);
  if (!j) return null;
  const type = logisticTypeOf(j);
  const prev = await prisma.mlFlexShipment.findUnique({ where: { shipmentId } });
  const order = await prisma.order.findUnique({ where: { mlShipmentId: shipmentId }, select: { id: true, mlQrRaw: true, createdAt: true } });

  if (type !== "self_service") {
    await prisma.mlFlexShipment.upsert({
      where: { shipmentId },
      create: { shipmentId, mlAccountId: account.id, clientId: account.clientId, logisticType: type ?? "desconocido", mlStatus: (j.status as string) ?? null },
      update: { logisticType: type ?? "desconocido", mlStatus: (j.status as string) ?? null, checkedAt: new Date() },
    });
    return type;
  }

  const m = mapMlShipment(j);
  let itemsSummary = prev?.itemsSummary ?? null;
  let buyerNickname = prev?.buyerNickname ?? null;
  let packId = prev?.packId ?? null;
  if (!itemsSummary) {
    const items = (await getJson(`${API}/shipments/${shipmentId}/items`, token, fetchImpl).catch(() => null)) as unknown as { description?: string; quantity?: number }[] | null;
    if (Array.isArray(items)) itemsSummary = items.map((i) => `${i.quantity ?? 1}× ${i.description ?? "artículo"}`).join(", ").slice(0, 300) || null;
  }
  if (!buyerNickname && m.mlOrderId) {
    const o = await getJson(`${API}/orders/${m.mlOrderId}`, token, fetchImpl).catch(() => null);
    buyerNickname = ((o?.buyer as { nickname?: string } | undefined)?.nickname ?? null) || null;
    packId = o?.pack_id != null ? BigInt(String(o.pack_id)) : null;
  }
  // El hash del QR NO viene en las etiquetas que entrega la API (hash_code: null): solo en la que
  // imprime el vendedor. Se obtiene al escanearla; aquí solo se conserva si ya lo teníamos.
  const qrRaw = prev?.qrRaw ?? (isFullMlQr(order?.mlQrRaw) ? order!.mlQrRaw : null);

  const lead = (j.lead_time ?? {}) as { estimated_delivery_time?: { date?: string } };
  const data = {
    mlAccountId: account.id,
    clientId: account.clientId,
    logisticType: type,
    mlStatus: m.mlStatus,
    mlSubstatus: m.mlSubstatus,
    mlOrderId: m.mlOrderId,
    packId,
    recipientName: m.recipientName,
    recipientPhone: m.recipientPhone,
    addressLine: m.addressLine,
    neighborhood: m.neighborhood,
    city: m.city,
    state: m.state,
    zip: m.zip,
    reference: m.instructions,
    lat: m.lat,
    lng: m.lng,
    itemsSummary,
    buyerNickname,
    mlCreatedAt: asDate(j.date_created),
    estimatedDelivery: asDate(lead.estimated_delivery_time?.date),
    qrRaw,
    checkedAt: new Date(),
    ...(order ? { orderId: order.id, scannedAt: prev?.scannedAt ?? order.createdAt } : {}),
  };
  await prisma.mlFlexShipment.upsert({ where: { shipmentId }, create: { shipmentId, ...data }, update: data });
  if (order && qrRaw && !order.mlQrRaw) await prisma.order.update({ where: { id: order.id }, data: { mlQrRaw: qrRaw } });
  return type;
}

/** Al escanear un envío ML: se liga a su registro de Recuperados (pasa al histórico) y se guarda el QR. */
export async function linkFlexScan(db: Db, orderId: string, shipmentId: bigint, raw: string) {
  const qr = isFullMlQr(raw) ? raw.trim() : null;
  if (qr) await db.order.updateMany({ where: { id: orderId, mlQrRaw: null }, data: { mlQrRaw: qr } });
  await db.mlFlexShipment.updateMany({ where: { shipmentId, orderId: null }, data: { orderId, scannedAt: new Date() } });
  if (qr) await db.mlFlexShipment.updateMany({ where: { shipmentId, qrRaw: null }, data: { qrRaw: qr } });
}

/**
 * Barrido de ventas recientes de todas las cuentas activas: encuentra envíos que no llegaron por
 * aviso. Solo consulta envíos que aún no conoce, con un tope por vuelta para no saturar la API.
 */
export async function sweepFlexShipments(prisma: PrismaClient, opts: { days?: number; maxNew?: number; fetchImpl?: Fetch } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const since = new Date(Date.now() - (opts.days ?? 3) * 86_400_000).toISOString().replace("Z", "-00:00");
  let budget = opts.maxNew ?? 400;
  const accounts = await prisma.mlAccount.findMany({ where: { status: "ACTIVE", accessTokenEnc: { not: null } }, select: { id: true, mlUserId: true }, orderBy: { updatedAt: "asc" } });
  let found = 0, flex = 0, errors = 0;
  for (const acc of accounts) {
    if (budget <= 0) break;
    try {
      const token = await mlAccessToken(prisma, acc.id, fetchImpl);
      if (!token) continue;
      const ids = new Set<string>();
      for (let offset = 0; offset < 500; offset += 50) {
        const r = await getJson(`${API}/orders/search?seller=${acc.mlUserId}&order.date_created.from=${encodeURIComponent(since)}&sort=date_desc&limit=50&offset=${offset}`, token, fetchImpl);
        const results = (r?.results ?? []) as { shipping?: { id?: number | string | null } }[];
        for (const o of results) if (o.shipping?.id) ids.add(String(o.shipping.id));
        const total = Number((r?.paging as { total?: number } | undefined)?.total ?? 0);
        if (results.length < 50 || offset + 50 >= total) break;
      }
      if (!ids.size) continue;
      const list = [...ids].map((x) => BigInt(x));
      const known = new Set((await prisma.mlFlexShipment.findMany({ where: { shipmentId: { in: list } }, select: { shipmentId: true } })).map((x) => x.shipmentId.toString()));
      for (const id of list) {
        if (known.has(id.toString()) || budget <= 0) continue;
        budget--;
        found++;
        const t = await captureShipment(prisma, acc.id, id, fetchImpl).catch(() => {
          errors++;
          return null;
        });
        if (t === "self_service") flex++;
      }
    } catch {
      errors++;
    }
  }
  return { accounts: accounts.length, found, flex, errors };
}

/** Actualiza el estado ML de los Flex abiertos sin escanear (para quitar cancelados o entregados por otros). */
export async function refreshOpenFlex(prisma: PrismaClient, opts: { limit?: number; fetchImpl?: Fetch } = {}) {
  const rows = await prisma.mlFlexShipment.findMany({
    where: { logisticType: "self_service", orderId: null, mlStatus: { in: FLEX_OPEN_STATUSES }, checkedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    orderBy: { checkedAt: "asc" },
    take: opts.limit ?? 100,
    select: { shipmentId: true, mlAccountId: true },
  });
  let n = 0;
  for (const r of rows) {
    await captureShipment(prisma, r.mlAccountId, r.shipmentId, opts.fetchImpl).then(() => n++).catch(() => {});
    await prisma.mlFlexShipment.update({ where: { shipmentId: r.shipmentId }, data: { checkedAt: new Date() } }).catch(() => {});
  }
  return n;
}

// ── Guía para reimprimir ──

export type GuiaData = {
  shipmentId: string;
  code: string | null; // código del pedido en Packatelas
  qrRaw: string | null;
  logisticType: string | null;
  sellerNickname: string;
  clientName: string;
  recipientName: string | null;
  recipientPhone: string | null;
  buyerNickname: string | null;
  addressLine: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  reference: string | null;
  itemsSummary: string | null;
  mlOrderId: string | null;
  packId: string | null;
  mlCreatedAt: Date | null;
  estimatedDelivery: Date | null;
};

/**
 * Datos de la guía de un envío ML. Si la cuenta está conectada se refrescan de la API antes de
 * armarla; si falta el QR con hash y `fetchQr` es true se pide la etiqueta a ML (si el vendedor no
 * la había impreso, ML la marca como impresa).
 */
export async function guiaData(prisma: PrismaClient, shipmentId: bigint, opts: { refresh?: boolean; fetchQr?: boolean; fetchImpl?: Fetch } = {}): Promise<GuiaData | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const load = () =>
    Promise.all([
      prisma.mlFlexShipment.findUnique({ where: { shipmentId }, include: { mlAccount: { select: { id: true, nickname: true } }, client: { select: { name: true } } } }),
      prisma.order.findUnique({ where: { mlShipmentId: shipmentId }, include: { mlAccount: { select: { id: true, nickname: true } }, client: { select: { name: true } } } }),
    ]);
  let [cap, order] = await load();
  const accountId = cap?.mlAccountId ?? order?.mlAccountId ?? null;
  if (!cap && !order) return null;
  if (opts.refresh !== false && accountId) {
    await captureShipment(prisma, accountId, shipmentId, fetchImpl).catch(() => null);
    [cap, order] = await load();
  }
  let qrRaw = [order?.mlQrRaw, cap?.qrRaw].find((q) => isFullMlQr(q)) ?? null;
  if (!qrRaw && opts.fetchQr && accountId) {
    const token = await mlAccessToken(prisma, accountId, fetchImpl).catch(() => null);
    qrRaw = token ? await fetchLabelQr(token, shipmentId, fetchImpl).catch(() => null) : null;
    if (qrRaw) {
      if (cap) await prisma.mlFlexShipment.update({ where: { id: cap.id }, data: { qrRaw } });
      if (order && !order.mlQrRaw) await prisma.order.update({ where: { id: order.id }, data: { mlQrRaw: qrRaw } });
    }
  }
  const pick = <T>(a: T | null | undefined, b: T | null | undefined) => (a ?? b ?? null) as T | null;
  const realAddress = order?.addressLine && order.addressLine !== "Pendiente de sincronizar con MercadoLibre" ? order.addressLine : null;
  return {
    shipmentId: shipmentId.toString(),
    code: order?.code ?? null,
    qrRaw,
    logisticType: cap?.logisticType ?? null,
    sellerNickname: (cap?.mlAccount ?? order?.mlAccount)?.nickname ?? "",
    clientName: (order?.client ?? cap?.client)?.name ?? "",
    recipientName: pick(order?.recipientName, cap?.recipientName),
    recipientPhone: pick(order?.recipientPhone, cap?.recipientPhone),
    buyerNickname: cap?.buyerNickname ?? null,
    addressLine: pick(realAddress, cap?.addressLine),
    neighborhood: pick(order?.neighborhood, cap?.neighborhood),
    city: pick(order?.city, cap?.city),
    state: pick(order?.state, cap?.state),
    zip: pick(order?.zip, cap?.zip),
    reference: pick(order?.instructions, cap?.reference),
    itemsSummary: pick(order?.itemsSummary, cap?.itemsSummary),
    mlOrderId: (order?.mlOrderId ?? cap?.mlOrderId)?.toString() ?? null,
    packId: (order?.mlPackId ?? cap?.packId)?.toString() ?? null,
    mlCreatedAt: cap?.mlCreatedAt ?? null,
    estimatedDelivery: cap?.estimatedDelivery ?? null,
  };
}
