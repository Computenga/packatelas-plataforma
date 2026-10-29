import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoInvoicePayments, cancelInvoice, cleanLegalName, invoiceFile, invoicePayment, missingFiscal, prisma, requestClientInvoice, saveInvoiceSettings, splitIva } from "./index.ts";

process.env.FACTURACOM_API_KEY = "K";
process.env.FACTURACOM_SECRET_KEY = "S";
delete process.env.FACTURACOM_ENTORNO;

const n = Math.floor(Math.random() * 1e6);
let clientId = "", adminId = "", prevSettings: unknown;
const calls: { url: string; method: string; body?: Record<string, unknown>; headers: Record<string, string> }[] = [];
let createFails = false;
let folio = 100;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
  if (/\/v1\/clients\/[A-Z0-9&Ñ]+$/.test(u)) return json({ status: "error", message: "No encontrado" });
  if (u.endsWith("/v1/clients/create")) return json({ status: "success", Data: { UID: "CLI123" } });
  if (/\/v1\/clients\/CLI123\/update$/.test(u)) return json({ status: "success", Data: { UID: "CLI123" } });
  if (u.endsWith("/v4/cfdi40/create")) {
    if (createFails) return json({ response: "error", message: { message: "Error en el nodo Receptor", messageDetail: "El RFC no está en la lista de RFC inscritos" } });
    folio++;
    return json({ response: "success", UUID: `uuid-${n}-${folio}`, uid: `inv${n}${folio}`, INV: { Serie: "P", Folio: folio }, SAT: { FechaTimbrado: "2026-10-29T12:00:00" } });
  }
  if (/\/cancel$/.test(u)) return json({ response: "success", message: "cancelado" });
  if (/\/pdf$/.test(u)) return new Response(Buffer.from("%PDF-1.4 prueba"), { headers: { "content-type": "application/pdf" } });
  return json({}, 404);
}) as typeof fetch;

async function pay(amount: number, method: "TRANSFER" | "MERCADOPAGO" = "TRANSFER", daysAgo = 0) {
  return prisma.payment.create({ data: { clientId, method, source: method === "MERCADOPAGO" ? "MERCADOPAGO" : "MANUAL", status: "APPLIED", amount, reference: `FAC${n}`, receivedAt: new Date(Date.now() - daysAgo * 86_400_000) } });
}

beforeAll(async () => {
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  prevSettings = (await prisma.setting.findUnique({ where: { key: "facturacion" } }))?.value;
  clientId = (await prisma.client.create({
    data: { publicId: `fac${n}`, name: "Facturas test", paymentReference: `FAC${n}`, tariffAmount: 0, rfc: "EKU9003173C9", legalName: "Escuela Kemper Urgate S.A. de C.V.", taxRegime: "601", taxZip: "42501", cfdiUse: "G03", email: "pruebas@ejemplo.mx" },
  })).id;
  await saveInvoiceSettings(prisma, { serieId: 1234, serieName: "P" }, adminId);
});
afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { clientId } });
  await prisma.payment.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.setting.deleteMany({ where: { key: "facturacion" } });
  if (prevSettings) await prisma.setting.create({ data: { key: "facturacion", value: prevSettings as object } });
  await prisma.$disconnect();
});

describe("cálculos y validaciones", () => {
  it("IVA incluido suma exacto al total pagado", () => {
    expect(splitIva(100, true)).toEqual({ base: 86.21, iva: 13.79, total: 100 });
    expect(splitIva(1575, true)).toEqual({ base: 1357.76, iva: 217.24, total: 1575 });
    expect(splitIva(100, false)).toEqual({ base: 100, iva: 16, total: 116 });
  });
  it("datos fiscales y razón social", () => {
    expect(missingFiscal({ rfc: "XAXX010101000", legalName: "", taxRegime: "6", taxZip: "123", cfdiUse: null, email: null }).length).toBe(6);
    expect(cleanLegalName("Escuela Kemper Urgate S.A. de C.V.")).toBe("ESCUELA KEMPER URGATE");
    expect(cleanLegalName("Comercializadora Computenga, S. de R.L. de C.V.")).toBe("COMERCIALIZADORA COMPUTENGA");
  });
});

describe("factura.com (pruebas)", () => {
  it("timbra un pago: da de alta al cliente, CFDI PUE con IVA y usa el sandbox", async () => {
    const p = await pay(1160);
    const inv = await invoicePayment(prisma, p.id, { requestedBy: "admin", actorUserId: adminId, fetchImpl: fakeFetch });
    expect(inv).toMatchObject({ status: "ISSUED", series: "P", sandbox: true, paymentForm: "03" });
    expect(inv.uuid).toContain("uuid-");
    const create = calls.find((c) => c.url.endsWith("/v4/cfdi40/create"))!;
    expect(create.url).toBe("https://sandbox.factura.com/api/v4/cfdi40/create");
    expect(create.headers["F-Api-Key"]).toBe("K");
    expect(create.headers["F-PLUGIN"]).toBeTruthy();
    expect(create.body).toMatchObject({ Receptor: { UID: "CLI123" }, MetodoPago: "PUE", FormaPago: "03", UsoCFDI: "G03", Serie: 1234, Moneda: "MXN", NumOrder: inv.id });
    const c = (create.body!.Conceptos as Record<string, unknown>[])[0];
    expect(c).toMatchObject({ ClaveProdServ: "78102203", ClaveUnidad: "E48", ValorUnitario: 1000, ObjetoImp: "02" });
    expect((c.Impuestos as { Traslados: { Importe: number }[] }).Traslados[0].Importe).toBe(160);
    const cli = calls.find((x) => x.url.endsWith("/v1/clients/create"))!;
    expect(cli.body).toMatchObject({ rfc: "EKU9003173C9", razons: "ESCUELA KEMPER URGATE", codpos: 42501, regimen: "601", pais: "MEX" });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).fcClientUid).toBe("sbx:CLI123");
    // No se factura dos veces el mismo pago.
    const again = await invoicePayment(prisma, p.id, { requestedBy: "admin", fetchImpl: fakeFetch });
    expect(again.id).toBe(inv.id);
    // Segunda factura: reutiliza el cliente (update, no create).
    const before = calls.filter((x) => x.url.endsWith("/v1/clients/create")).length;
    await invoicePayment(prisma, (await pay(200, "MERCADOPAGO")).id, { requestedBy: "admin", fetchImpl: fakeFetch });
    expect(calls.filter((x) => x.url.endsWith("/v1/clients/create")).length).toBe(before);
    expect(calls.filter((x) => x.url.endsWith("/v4/cfdi40/create")).at(-1)!.body!.FormaPago).toBe("04");
  });

  it("un error de factura.com queda como FALLIDA con el mensaje", async () => {
    createFails = true;
    const p = await pay(50);
    await expect(invoicePayment(prisma, p.id, { requestedBy: "admin", fetchImpl: fakeFetch })).rejects.toThrow(/Receptor/);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(inv.status).toBe("FAILED");
    expect(inv.error).toContain("RFC no está");
    createFails = false;
  });

  it("descarga el PDF y cancela", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { clientId, status: "ISSUED" } });
    const f = await invoiceFile(prisma, inv.id, "pdf", fakeFetch);
    expect(f.bytes.toString()).toContain("%PDF");
    const c = await cancelInvoice(prisma, inv.id, "02", adminId, fakeFetch);
    expect(c.status).toBe("CANCELLED");
    expect(calls.find((x) => x.url.endsWith("/cancel"))!.body).toEqual({ motivo: "02", folioSustituto: "" });
  });

  it("el cliente solo pide factura de sus pagos dentro del plazo", async () => {
    const old = await pay(300, "TRANSFER", 45);
    await expect(requestClientInvoice(prisma, clientId, old.id, adminId, fakeFetch)).rejects.toThrow(/30 días/);
    const ok = await pay(300);
    expect((await requestClientInvoice(prisma, clientId, ok.id, adminId, fakeFetch)).status).toBe("ISSUED");
  });

  it("automática: apagada no hace nada; encendida factura los pagos nuevos de clientes marcados", async () => {
    await prisma.client.update({ where: { id: clientId }, data: { autoInvoice: true } });
    expect(await autoInvoicePayments(prisma, 20, fakeFetch)).toEqual({ issued: 0, failed: 0 });
    await saveInvoiceSettings(prisma, { autoEnabled: true }, adminId);
    const p = await pay(580);
    const r = await autoInvoicePayments(prisma, 20, fakeFetch);
    expect(r.issued).toBe(1);
    expect((await prisma.invoice.findFirstOrThrow({ where: { paymentId: p.id } })).requestedBy).toBe("auto");
    expect((await autoInvoicePayments(prisma, 20, fakeFetch)).issued).toBe(0);
  });
});
