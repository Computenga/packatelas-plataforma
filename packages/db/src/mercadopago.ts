// Pago de saldo con tarjeta por Mercado Pago (Checkout Pro) [I09].
// El cliente elige cuánto abonar; se le cobra ese monto más la comisión configurada. Al aprobarse,
// el abono entra solo a su saldo (PAYMENT por el total y FEE por la comisión: neto = lo abonado).
// Si después se devuelve o hay contracargo, el abono se revierte.
import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;
type Fetch = typeof fetch;
const API = "https://api.mercadopago.com";
const KEY = "mp.settings";

/** Tramo de comisión: aplica a abonos hasta `upTo` (incluido); `null` = en adelante. */
export type MpFeeTier = { upTo: number | null; percent: number; fixed: number };
export type MpSettings = { enabled: boolean; tiers: MpFeeTier[]; minAmount: number };
const DEFAULTS: MpSettings = { enabled: false, tiers: [{ upTo: null, percent: 0, fixed: 0 }], minAmount: 100 };

export function mpConfigured() {
  return !!process.env.MP_ACCESS_TOKEN?.trim();
}

export async function getMpSettings(db: Db): Promise<MpSettings> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value as Partial<MpSettings> | undefined) ?? {};
  return { ...DEFAULTS, ...v, tiers: Array.isArray(v.tiers) && v.tiers.length ? v.tiers : DEFAULTS.tiers };
}

/** Ordena los tramos y deja el último abierto ("en adelante"). */
export function normalizeTiers(tiers: MpFeeTier[]): MpFeeTier[] {
  const t = tiers
    .filter((x) => Number.isFinite(x.percent) && Number.isFinite(x.fixed))
    .map((x) => ({ upTo: x.upTo == null || !Number.isFinite(x.upTo) ? null : x.upTo, percent: x.percent, fixed: x.fixed }));
  const bounded = t.filter((x) => x.upTo != null).sort((a, b) => a.upTo! - b.upTo!);
  const open = t.find((x) => x.upTo == null) ?? { upTo: null, percent: 0, fixed: 0 };
  return [...bounded, open];
}

export async function saveMpSettings(db: Db, s: MpSettings, actorUserId: string) {
  const tiers = normalizeTiers(s.tiers);
  for (const t of tiers) {
    if (!(t.percent >= 0 && t.percent <= 20) || !(t.fixed >= 0 && t.fixed <= 1000)) throw new Error("Comisión fuera de rango (0–20 % y $0–$1,000)");
    if (t.upTo != null && !(t.upTo > 0)) throw new Error("Los límites de los tramos deben ser mayores a 0");
  }
  if (new Set(tiers.map((t) => t.upTo)).size !== tiers.length) throw new Error("Hay dos tramos con el mismo límite");
  if (!(s.minAmount >= 10 && s.minAmount <= 100000)) throw new Error("Monto mínimo fuera de rango");
  const value = { enabled: s.enabled, tiers, minAmount: s.minAmount };
  await db.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  await audit(db, { actorUserId, action: "mp.settings", entity: "Setting", entityId: KEY, summary: `Mercado Pago ${s.enabled ? "activo" : "apagado"}; comisión: ${describeTiers(tiers)}; mínimo $${s.minAmount}` });
}

export function describeTiers(tiers: MpFeeTier[]) {
  return tiers
    .map((t) => {
      const fee = [t.percent ? `${t.percent}%` : "", t.fixed ? `$${t.fixed}` : ""].filter(Boolean).join(" + ") || "sin comisión";
      return `${t.upTo == null ? "resto" : `hasta $${t.upTo}`}: ${fee}`;
    })
    .join("; ");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Comisión de un abono según el tramo que le toca. */
export function feeFor(tiers: MpFeeTier[], amount: number) {
  const t = tiers.find((x) => x.upTo == null || amount <= x.upTo) ?? tiers[tiers.length - 1];
  return t ? r2((amount * t.percent) / 100 + t.fixed) : 0;
}

/** Comisión y total a cobrar por un abono. */
export function quote(s: Pick<MpSettings, "tiers">, amount: number) {
  const a = r2(amount);
  const fee = feeFor(s.tiers, a);
  return { amount: a, fee, total: r2(a + fee) };
}

async function mp<T>(path: string, init: RequestInit = {}, fetchImpl: Fetch = fetch): Promise<T> {
  const token = process.env.MP_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("Mercado Pago no está configurado");
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Abre un pago: crea la preferencia y devuelve la liga de Mercado Pago. */
export async function createCheckout(
  prisma: PrismaClient,
  input: { clientId: string; amount: number; actorUserId?: string; baseUrl: string },
  fetchImpl: Fetch = fetch,
) {
  const s = await getMpSettings(prisma);
  if (!s.enabled || !mpConfigured()) throw new Error("El pago con tarjeta aún no está disponible");
  if (!(input.amount >= s.minAmount)) throw new Error(`El monto mínimo es $${s.minAmount}`);
  if (input.amount > 200_000) throw new Error("Monto demasiado alto; haz una transferencia");
  const client = await prisma.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { publicId: true, name: true, email: true } });
  const q = quote(s, input.amount);
  const c = await prisma.mpCheckout.create({
    data: { clientId: input.clientId, amount: q.amount, fee: q.fee, total: q.total, createdById: input.actorUserId },
  });
  const base = input.baseUrl.replace(/\/$/, "");
  const pref = await mp<{ id: string; init_point: string }>(
    "/checkout/preferences",
    {
      method: "POST",
      headers: { "X-Idempotency-Key": c.id },
      body: JSON.stringify({
        items: [{ id: client.publicId, title: `Abono a cuenta Packatelas ${client.publicId.toUpperCase()}`, quantity: 1, unit_price: q.total, currency_id: "MXN" }],
        external_reference: c.id,
        statement_descriptor: "PACKATELAS",
        notification_url: `${base}/api/mp/webhook`,
        back_urls: { success: `${base}/cliente/cuenta?pago=ok`, pending: `${base}/cliente/cuenta?pago=pendiente`, failure: `${base}/cliente/cuenta?pago=error` },
        auto_return: "approved",
        expires: true,
        expiration_date_to: new Date(Date.now() + 24 * 3600_000).toISOString(),
        ...(client.email ? { payer: { email: client.email } } : {}),
      }),
    },
    fetchImpl,
  );
  await prisma.mpCheckout.update({ where: { id: c.id }, data: { preferenceId: pref.id } });
  return { id: c.id, url: pref.init_point, ...q };
}

/**
 * Firma del aviso de Mercado Pago: x-signature "ts=…,v1=…" = HMAC-SHA256(secreto,
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;").
 */
export function validMpSignature(secret: string, signature: string | null, requestId: string | null, dataId: string | null) {
  if (!signature || !dataId) return false;
  const parts = Object.fromEntries(signature.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const got = Buffer.from(parts.v1);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

type MpPayment = { id: number; status: string; status_detail?: string; external_reference?: string; transaction_amount: number; currency_id: string; payer?: { email?: string }; date_approved?: string | null };

/**
 * Aplica el estado de un pago de Mercado Pago (desde el aviso o la conciliación). Consulta el pago
 * en la API (no se confía en el cuerpo del aviso) y es idempotente.
 */
export async function syncMpPayment(prisma: PrismaClient, mpPaymentId: string, fetchImpl: Fetch = fetch) {
  const p = await mp<MpPayment>(`/v1/payments/${encodeURIComponent(mpPaymentId)}`, {}, fetchImpl);
  if (!p.external_reference) return { status: "ignored" as const };
  const c = await prisma.mpCheckout.findUnique({ where: { id: p.external_reference } });
  if (!c) return { status: "ignored" as const };
  const id = String(p.id);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MpCheckout" WHERE id = ${c.id} FOR UPDATE`;
    const cur = await tx.mpCheckout.findUniqueOrThrow({ where: { id: c.id } });
    if (p.status === "approved") {
      if (cur.status === "APPROVED" || cur.status === "REFUNDED") return { status: "duplicate" as const };
      if (p.currency_id !== "MXN" || Math.abs(p.transaction_amount - Number(cur.total)) > 0.01) {
        await tx.mpCheckout.update({ where: { id: cur.id }, data: { mpPaymentId: id, detail: `Monto distinto: ${p.transaction_amount} ${p.currency_id}` } });
        return { status: "mismatch" as const };
      }
      const payment = await tx.payment.create({
        data: {
          clientId: cur.clientId, method: "MERCADOPAGO", source: "MERCADOPAGO", status: "APPLIED", amount: cur.total, fee: cur.fee,
          reference: `MP ${id}`, trackingKey: `mp:${id}`, externalId: `mp:${id}`, senderName: p.payer?.email?.slice(0, 120) ?? null,
          receivedAt: p.date_approved ? new Date(p.date_approved) : new Date(),
        },
      });
      await tx.ledgerEntry.create({ data: { clientId: cur.clientId, type: "PAYMENT", amount: new Prisma.Decimal(cur.total).neg(), description: `Pago con tarjeta (Mercado Pago ${id})`, paymentId: payment.id } });
      if (Number(cur.fee) > 0) {
        await tx.ledgerEntry.create({ data: { clientId: cur.clientId, type: "FEE", amount: cur.fee, description: `Comisión por pago con tarjeta (Mercado Pago ${id})`, paymentId: payment.id } });
      }
      await tx.mpCheckout.update({ where: { id: cur.id }, data: { status: "APPROVED", mpPaymentId: id, paymentId: payment.id, detail: p.status_detail ?? null } });
      await audit(tx, { action: "mp.payment_applied", entity: "Payment", entityId: payment.id, summary: `Pago con tarjeta aplicado: $${cur.amount} (+ comisión $${cur.fee})` });
      return { status: "applied" as const, paymentId: payment.id };
    }
    if (["refunded", "charged_back", "cancelled"].includes(p.status) && cur.status === "APPROVED" && cur.paymentId) {
      // Devolución o contracargo: se revierte el abono completo (el cliente vuelve a deber).
      await tx.ledgerEntry.create({ data: { clientId: cur.clientId, type: "ADJUSTMENT", amount: new Prisma.Decimal(cur.amount), description: `Reversa de pago con tarjeta (${p.status === "charged_back" ? "contracargo" : "devolución"} MP ${id})`, paymentId: cur.paymentId } });
      await tx.payment.update({ where: { id: cur.paymentId }, data: { status: "REJECTED", note: `Mercado Pago: ${p.status}` } });
      await tx.mpCheckout.update({ where: { id: cur.id }, data: { status: "REFUNDED", detail: p.status } });
      await audit(tx, { action: "mp.payment_reversed", entity: "Payment", entityId: cur.paymentId, summary: `Pago con tarjeta revertido (${p.status}): $${cur.amount}` });
      return { status: "reversed" as const };
    }
    if (["rejected", "cancelled"].includes(p.status) && cur.status === "PENDING") {
      await tx.mpCheckout.update({ where: { id: cur.id }, data: { status: "REJECTED", mpPaymentId: id, detail: p.status_detail ?? p.status } });
      return { status: "rejected" as const };
    }
    if (cur.status === "PENDING") await tx.mpCheckout.update({ where: { id: cur.id }, data: { mpPaymentId: id, detail: p.status_detail ?? p.status } });
    return { status: "pending" as const };
  });
}

/** Conciliación (por si un aviso no llegó): revisa pagos abiertos de las últimas 48 h. */
export async function reconcileMp(prisma: PrismaClient, fetchImpl: Fetch = fetch) {
  if (!mpConfigured()) return { checked: 0, applied: 0 };
  const open = await prisma.mpCheckout.findMany({
    where: { status: "PENDING", createdAt: { gte: new Date(Date.now() - 48 * 3600_000), lte: new Date(Date.now() - 5 * 60_000) } },
    take: 50,
  });
  let applied = 0;
  for (const c of open) {
    const r = await mp<{ results: { id: number }[] }>(`/v1/payments/search?external_reference=${c.id}&sort=date_created&criteria=desc`, {}, fetchImpl).catch(() => ({ results: [] }));
    for (const x of r.results.slice(0, 3)) {
      const s = await syncMpPayment(prisma, String(x.id), fetchImpl).catch(() => null);
      if (s?.status === "applied") applied++;
    }
  }
  await prisma.mpCheckout.updateMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 48 * 3600_000) } }, data: { status: "EXPIRED" } });
  return { checked: open.length, applied };
}
