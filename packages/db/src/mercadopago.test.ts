import "dotenv/config";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckout, getClientBalance, normalizeTiers, prisma, quote, reconcileMp, saveMpSettings, syncMpPayment, validMpSignature } from "./index.ts";

const n = Math.floor(Math.random() * 1e6);
let clientId = "";
let adminId = "";
process.env.MP_ACCESS_TOKEN = "TEST-token";

// Mercado Pago simulado: preferencias y pagos en memoria.
const payments = new Map<string, Record<string, unknown>>();
const calls: { url: string; body?: unknown; auth?: string }[] = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, body, auth: (init?.headers as Record<string, string>)?.Authorization });
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
  if (url.endsWith("/checkout/preferences")) return json({ id: `pref-${calls.length}`, init_point: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=x" });
  const m = /\/v1\/payments\/(\d+)$/.exec(url);
  if (m) return payments.has(m[1]) ? json(payments.get(m[1])) : json({ message: "not found" }, 404);
  const s = /external_reference=([^&]+)/.exec(url);
  if (s) return json({ results: [...payments.values()].filter((p) => p.external_reference === s[1]).map((p) => ({ id: p.id })) });
  return json({}, 404);
}) as typeof fetch;

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: `mp${n}`, name: "MP test", paymentReference: `MP${n}`, tariffAmount: 50 } })).id;
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await saveMpSettings(prisma, { enabled: true, tiers: [{ upTo: 999.99, percent: 4, fixed: 4 }, { upTo: 5000, percent: 0, fixed: 5 }, { upTo: null, percent: 0, fixed: 0 }], minAmount: 100 }, adminId);
});
afterAll(async () => {
  await prisma.mpCheckout.deleteMany({ where: { clientId } });
  await prisma.ledgerEntry.deleteMany({ where: { clientId } });
  await prisma.payment.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.setting.delete({ where: { key: "mp.settings" } }).catch(() => {});
  await prisma.$disconnect();
});

describe("comisión", () => {
  it("por tramos, descontada del pago: <$1000 4% y luego $4; $1000–$5000 $5; más de $5000 nada", () => {
    const tiers = normalizeTiers([{ upTo: null, percent: 0, fixed: 0 }, { upTo: 5000, percent: 0, fixed: 5 }, { upTo: 999.99, percent: 4, fixed: 4 }]);
    expect(quote({ tiers }, 500)).toEqual({ total: 500, fee: 24, amount: 476 });
    expect(quote({ tiers }, 999.99)).toEqual({ total: 999.99, fee: 44, amount: 955.99 });
    expect(quote({ tiers }, 1000)).toEqual({ total: 1000, fee: 5, amount: 995 });
    expect(quote({ tiers }, 5000)).toEqual({ total: 5000, fee: 5, amount: 4995 });
    expect(quote({ tiers }, 5000.01)).toEqual({ total: 5000.01, fee: 0, amount: 5000.01 });
  });
});

describe("firma del aviso", () => {
  it("acepta solo la firma correcta", () => {
    const secret = "s3cr3t";
    const v1 = createHmac("sha256", secret).update("id:123;request-id:req-1;ts:1700000000;").digest("hex");
    expect(validMpSignature(secret, `ts=1700000000,v1=${v1}`, "req-1", "123")).toBe(true);
    expect(validMpSignature(secret, `ts=1700000001,v1=${v1}`, "req-1", "123")).toBe(false);
    expect(validMpSignature(secret, `ts=1700000000,v1=${v1}`, "req-1", "124")).toBe(false);
    expect(validMpSignature("otro", `ts=1700000000,v1=${v1}`, "req-1", "123")).toBe(false);
    expect(validMpSignature(secret, null, "req-1", "123")).toBe(false);
  });
});

describe("pago con tarjeta", () => {
  it("abona solo el monto elegido, una vez, y lo revierte si se devuelve", async () => {
    await expect(createCheckout(prisma, { clientId, amount: 50, baseUrl: "https://x.test" }, fakeFetch)).rejects.toThrow(/mínimo/);
    const before = Number(await getClientBalance(prisma, clientId));
    const c = await createCheckout(prisma, { clientId, amount: 500, baseUrl: "https://x.test/" }, fakeFetch);
    expect(c).toMatchObject({ total: 500, fee: 24, amount: 476 });
    const pref = calls.find((x) => x.url.endsWith("/checkout/preferences"))!;
    expect(pref.auth).toBe("Bearer TEST-token");
    expect(pref.body).toMatchObject({ external_reference: c.id, notification_url: "https://x.test/api/mp/webhook", items: [{ unit_price: 500, currency_id: "MXN" }] });

    // Monto alterado: no se aplica.
    payments.set("900", { id: 900, status: "approved", external_reference: c.id, transaction_amount: 1, currency_id: "MXN" });
    expect((await syncMpPayment(prisma, "900", fakeFetch)).status).toBe("mismatch");

    payments.set("901", { id: 901, status: "approved", external_reference: c.id, transaction_amount: 500, currency_id: "MXN", date_approved: new Date().toISOString() });
    const [a, b] = await Promise.all([syncMpPayment(prisma, "901", fakeFetch), syncMpPayment(prisma, "901", fakeFetch)]);
    expect([a.status, b.status].sort()).toEqual(["applied", "duplicate"]);
    expect(Number(await getClientBalance(prisma, clientId))).toBeCloseTo(before - 476, 2);
    expect(await prisma.payment.count({ where: { clientId, method: "MERCADOPAGO", status: "APPLIED" } })).toBe(1);

    payments.set("901", { ...payments.get("901"), status: "charged_back" });
    expect((await syncMpPayment(prisma, "901", fakeFetch)).status).toBe("reversed");
    expect(Number(await getClientBalance(prisma, clientId))).toBeCloseTo(before, 2);
    expect((await prisma.mpCheckout.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("REFUNDED");
  });

  it("la conciliación aplica un pago cuyo aviso no llegó", async () => {
    const c = await createCheckout(prisma, { clientId, amount: 200, baseUrl: "https://x.test" }, fakeFetch);
    await prisma.mpCheckout.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - 15 * 60_000) } });
    payments.set("902", { id: 902, status: "approved", external_reference: c.id, transaction_amount: 200, currency_id: "MXN" });
    const r = await reconcileMp(prisma, fakeFetch);
    expect(r.applied).toBeGreaterThanOrEqual(1);
    expect((await prisma.mpCheckout.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("APPROVED");
  });

  it("ignora pagos ajenos", async () => {
    payments.set("903", { id: 903, status: "approved", external_reference: "otra-cosa", transaction_amount: 10, currency_id: "MXN" });
    expect((await syncMpPayment(prisma, "903", fakeFetch)).status).toBe("ignored");
  });
});
