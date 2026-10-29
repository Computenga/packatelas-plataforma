import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoInvoicePayments, cancelInvoice, cleanLegalName, facturaConfig, invoiceFile, invoicePayment, missingFiscal, prisma, requestClientInvoice, saveInvoiceSettings } from "./index.ts";

process.env.FACTURAPI_KEY = "sk_test_PRUEBA";

const n = Math.floor(Math.random() * 1e6);
let clientId = "", adminId = "", prevSettings: unknown;
const calls: { url: string; method: string; body?: Record<string, unknown>; auth?: string }[] = [];
let createFails = false;
let folio = 100;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? "GET";
  calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>)?.Authorization });
  if (u.includes("/customers?q=")) return json({ data: [] });
  if (u.endsWith("/v2/customers") && method === "POST") return json({ id: "cus_123", tax_id: "EKU9003173C9" });
  if (u.endsWith("/v2/customers/cus_123") && method === "PUT") return json({ id: "cus_123", tax_id: "EKU9003173C9" });
  if (u.endsWith("/v2/invoices") && method === "POST") {
    if (createFails) return json({ message: "El RFC del receptor no está en la lista de RFC inscritos no cancelados del SAT", path: "customer.tax_id" }, 400);
    folio++;
    const b = JSON.parse(String(init!.body));
    return json({ id: `inv_${folio}`, uuid: `uuid-${n}-${folio}`, status: "valid", series: b.series ?? "A", folio_number: folio, total: b.items[0].product.price, livemode: false });
  }
  if (/\/email$/.test(u)) return json({ ok: true });
  if (method === "DELETE") return json({ status: "canceled", cancellation_status: "accepted" });
  if (/\/pdf$/.test(u)) return new Response(Buffer.from("%PDF-1.4 prueba"), { headers: { "content-type": "application/pdf" } });
  return json({ message: "no encontrado" }, 404);
}) as typeof fetch;

async function pay(amount: number, method: "TRANSFER" | "MERCADOPAGO" = "TRANSFER", daysAgo = 0) {
  return prisma.payment.create({ data: { clientId, method, source: method === "MERCADOPAGO" ? "MERCADOPAGO" : "MANUAL", status: "APPLIED", amount, reference: `FAC${n}`, receivedAt: new Date(Date.now() - daysAgo * 86_400_000) } });
}

beforeAll(async () => {
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  prevSettings = (await prisma.setting.findUnique({ where: { key: "facturacion" } }))?.value;
  await prisma.setting.deleteMany({ where: { key: "facturacion" } });
  clientId = (await prisma.client.create({
    data: { publicId: `fac${n}`, name: "Facturas test", paymentReference: `FAC${n}`, tariffAmount: 0, rfc: "EKU9003173C9", legalName: "Escuela Kemper Urgate S.A. de C.V.", taxRegime: "601", taxZip: "42501", cfdiUse: "G03", email: "pruebas@ejemplo.mx" },
  })).id;
  await saveInvoiceSettings(prisma, { serie: "p" }, adminId);
});
afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { clientId } });
  await prisma.payment.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.setting.deleteMany({ where: { key: "facturacion" } });
  if (prevSettings) await prisma.setting.create({ data: { key: "facturacion", value: prevSettings as object } });
  await prisma.$disconnect();
});

describe("validaciones", () => {
  it("datos fiscales, razón social y modo según la llave", () => {
    expect(missingFiscal({ rfc: "XAXX010101000", legalName: "", taxRegime: "6", taxZip: "123", cfdiUse: null, email: null }).length).toBe(6);
    expect(cleanLegalName("Escuela Kemper Urgate S.A. de C.V.")).toBe("ESCUELA KEMPER URGATE");
    expect(cleanLegalName("Comercializadora Computenga, S. de R.L. de C.V.")).toBe("COMERCIALIZADORA COMPUTENGA");
    expect(facturaConfig()?.sandbox).toBe(true);
    process.env.FACTURAPI_KEY = "sk_live_X";
    expect(facturaConfig()?.sandbox).toBe(false);
    process.env.FACTURAPI_KEY = "sk_test_PRUEBA";
  });
});

describe("Facturapi (pruebas)", () => {
  it("timbra un pago: alta del cliente, CFDI PUE con IVA incluido, idempotente y manda correo", async () => {
    const p = await pay(1160);
    const inv = await invoicePayment(prisma, p.id, { requestedBy: "admin", actorUserId: adminId, fetchImpl: fakeFetch });
    expect(inv).toMatchObject({ status: "ISSUED", series: "P", sandbox: true, paymentForm: "03", providerUid: expect.stringMatching(/^inv_/) });
    const create = calls.find((c) => c.url === "https://www.facturapi.io/v2/invoices")!;
    expect(create.auth).toBe("Bearer sk_test_PRUEBA");
    expect(create.body).toMatchObject({ customer: "cus_123", payment_method: "PUE", payment_form: "03", use: "G03", series: "P", currency: "MXN", external_id: inv.id, idempotency_key: inv.id });
    expect((create.body!.items as { product: Record<string, unknown> }[])[0].product).toMatchObject({ product_key: "78102203", unit_key: "E48", price: 1160, tax_included: true, taxes: [{ type: "IVA", rate: 0.16 }] });
    const cus = calls.find((c) => c.url.endsWith("/v2/customers") && c.method === "POST")!;
    expect(cus.body).toMatchObject({ tax_id: "EKU9003173C9", legal_name: "ESCUELA KEMPER URGATE", tax_system: "601", address: { zip: "42501" } });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).billingCustomerId).toBe("test:cus_123");
    expect(calls.some((c) => c.url.endsWith(`/invoices/${inv.providerUid}/email`))).toBe(true);
    const again = await invoicePayment(prisma, p.id, { requestedBy: "admin", fetchImpl: fakeFetch });
    expect(again.id).toBe(inv.id);
    // Segunda factura: actualiza al cliente (PUT), no lo vuelve a crear; tarjeta = 04.
    const before = calls.filter((c) => c.url.endsWith("/v2/customers") && c.method === "POST").length;
    await invoicePayment(prisma, (await pay(200, "MERCADOPAGO")).id, { requestedBy: "admin", fetchImpl: fakeFetch });
    expect(calls.filter((c) => c.url.endsWith("/v2/customers") && c.method === "POST").length).toBe(before);
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/v2/invoices")).at(-1)!.body!.payment_form).toBe("04");
  });

  it("un error de Facturapi queda como FALLIDA con el mensaje", async () => {
    createFails = true;
    const p = await pay(50);
    await expect(invoicePayment(prisma, p.id, { requestedBy: "admin", fetchImpl: fakeFetch })).rejects.toThrow(/lista de RFC/);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(inv.status).toBe("FAILED");
    expect(inv.error).toContain("customer.tax_id");
    createFails = false;
  });

  it("descarga el PDF y cancela con motivo", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { clientId, status: "ISSUED" } });
    expect((await invoiceFile(prisma, inv.id, "pdf", fakeFetch)).bytes.toString()).toContain("%PDF");
    expect((await cancelInvoice(prisma, inv.id, "02", adminId, fakeFetch)).status).toBe("CANCELLED");
    expect(calls.find((c) => c.method === "DELETE")!.url).toBe(`https://www.facturapi.io/v2/invoices/${inv.providerUid}?motive=02`);
  });

  it("el cliente solo pide factura de sus pagos dentro del plazo", async () => {
    const old = await pay(300, "TRANSFER", 45);
    await expect(requestClientInvoice(prisma, clientId, old.id, adminId, fakeFetch)).rejects.toThrow(/30 días/);
    expect((await requestClientInvoice(prisma, clientId, (await pay(300)).id, adminId, fakeFetch)).status).toBe("ISSUED");
  });

  it("automática: apagada no hace nada; encendida factura los pagos nuevos de clientes marcados", async () => {
    await prisma.client.update({ where: { id: clientId }, data: { autoInvoice: true } });
    expect(await autoInvoicePayments(prisma, 20, fakeFetch)).toEqual({ issued: 0, failed: 0 });
    await saveInvoiceSettings(prisma, { autoEnabled: true }, adminId);
    const p = await pay(580);
    expect((await autoInvoicePayments(prisma, 20, fakeFetch)).issued).toBe(1);
    expect((await prisma.invoice.findFirstOrThrow({ where: { paymentId: p.id } })).requestedBy).toBe("auto");
    expect((await autoInvoicePayments(prisma, 20, fakeFetch)).issued).toBe(0);
  });
});
