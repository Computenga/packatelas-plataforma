// Facturación electrónica CFDI 4.0 con Facturapi [I05, I10].
// - Cada pago aplicado (transferencia o tarjeta) se puede facturar: en automático para los clientes
//   con «Facturar en automático», a solicitud del cliente desde su portal, o desde administración.
// - CFDI de ingreso PUE por el monto pagado; precio con IVA incluido por omisión (configurable).
//   Facturapi calcula el desglose de impuestos.
// - Modo de pruebas o real según la llave: FACTURAPI_KEY=sk_test_… (pruebas) o sk_live_… (real).
// - El cliente se da de alta en Facturapi por RFC la primera vez y se reutiliza su id.
import type { Prisma, PrismaClient, PaymentMethod } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;
type Fetch = typeof fetch;
const KEY = "facturacion";
const API = "https://www.facturapi.io/v2";

export type InvoiceSettings = {
  autoEnabled: boolean;
  enabledAt: string | null;
  serie: string | null; // opcional; si va vacía Facturapi usa la de la organización
  claveProdServ: string;
  claveUnidad: string;
  unidad: string;
  descripcion: string;
  preciosConIva: boolean;
  formaPagoTarjeta: string; // 04 crédito, 28 débito
  enviarCorreo: boolean;
  diasSolicitud: number; // días que tiene el cliente para pedir factura de un pago
};

const DEFAULTS: InvoiceSettings = {
  autoEnabled: false,
  enabledAt: null,
  serie: null,
  claveProdServ: "78102203",
  claveUnidad: "E48",
  unidad: "Unidad de servicio",
  descripcion: "Servicio de mensajería y entrega de paquetes",
  preciosConIva: true,
  formaPagoTarjeta: "04",
  enviarCorreo: true,
  diasSolicitud: 30,
};

export function facturaConfig() {
  const key = process.env.FACTURAPI_KEY?.trim();
  if (!key) return null;
  return { key, sandbox: !key.startsWith("sk_live_") };
}

export async function getInvoiceSettings(db: Db): Promise<InvoiceSettings> {
  const r = await db.setting.findUnique({ where: { key: KEY } });
  return { ...DEFAULTS, ...((r?.value as Partial<InvoiceSettings> | undefined) ?? {}) };
}

export async function saveInvoiceSettings(db: Db, patch: Partial<InvoiceSettings>, actorUserId: string) {
  const cur = await getInvoiceSettings(db);
  const next = { ...cur, ...patch };
  next.serie = next.serie?.trim().toUpperCase() || null;
  if (next.serie && !/^[A-Z0-9]{1,25}$/.test(next.serie)) throw new Error("La serie solo lleva letras y números");
  if (!/^\d{8}$/.test(next.claveProdServ)) throw new Error("La clave de producto o servicio SAT son 8 dígitos");
  if (!/^[A-Z0-9]{2,3}$/.test(next.claveUnidad)) throw new Error("Clave de unidad SAT inválida");
  if (!/^\d{2}$/.test(next.formaPagoTarjeta)) throw new Error("Forma de pago inválida");
  if (!next.descripcion.trim()) throw new Error("Falta la descripción");
  if (next.autoEnabled && !cur.autoEnabled) next.enabledAt = new Date().toISOString();
  await db.setting.upsert({ where: { key: KEY }, update: { value: next }, create: { key: KEY, value: next } });
  await audit(db, { actorUserId, action: "facturacion.settings", entity: "Setting", entityId: KEY, summary: `Facturación automática ${next.autoEnabled ? "ENCENDIDA" : "apagada"}; serie ${next.serie ?? "(la de Facturapi)"}; clave ${next.claveProdServ}` });
  return next;
}

// ── Llamadas a Facturapi ──

export class FacturaError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
  }
}

async function fapi<T = Record<string, unknown>>(path: string, init: RequestInit & { raw?: boolean } = {}, fetchImpl: Fetch = fetch): Promise<T> {
  const cfg = facturaConfig();
  if (!cfg) throw new FacturaError("Falta configurar Facturapi (FACTURAPI_KEY)");
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.key}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(45_000),
  });
  if (init.raw) {
    if (!res.ok) throw new FacturaError(`Facturapi respondió ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res as unknown as T;
  }
  const text = await res.text();
  let j: { message?: string; path?: string } & Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    throw new FacturaError(`Facturapi respondió ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new FacturaError(`${j.message ?? `Facturapi respondió ${res.status}`}${j.path ? ` (${j.path})` : ""}`, j);
  return j as T;
}

// ── Datos fiscales del cliente ──

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** Revisa que el cliente tenga lo necesario para un CFDI 4.0; devuelve la lista de faltantes. */
export function missingFiscal(c: { rfc: string | null; legalName: string | null; taxRegime: string | null; taxZip: string | null; cfdiUse: string | null; email: string | null }) {
  const m: string[] = [];
  const rfc = c.rfc?.trim().toUpperCase() ?? "";
  if (!RFC_RE.test(rfc)) m.push("RFC");
  else if (rfc === "XAXX010101000" || rfc === "XEXX010101000") m.push("RFC (el genérico no se factura de forma individual)");
  if (!c.legalName?.trim()) m.push("razón social");
  if (!/^\d{3}$/.test(c.taxRegime?.trim() ?? "")) m.push("régimen fiscal");
  if (!/^\d{5}$/.test(c.taxZip?.trim() ?? "")) m.push("código postal fiscal");
  if (!/^[A-Z]{1,2}\d{2}$/.test(c.cfdiUse?.trim().toUpperCase() ?? "")) m.push("uso de CFDI");
  if (!c.email?.includes("@")) m.push("correo");
  return m;
}

/** Quita el régimen societario del nombre (el SAT y Facturapi lo piden sin «S.A. de C.V.»). */
export function cleanLegalName(name: string) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[,\s]+(S\.?\s?A\.?\s?P\.?\s?I\.?|S\.?\s?A\.?|S\.?\s?DE\s?R\.?\s?L\.?|S\.?\s?C\.?|A\.?\s?C\.?|S\.?\s?A\.?\s?S\.?)(\s+DE\s+C\.?\s?V\.?)?\.?$/i, "")
    .trim();
}

type FapiCustomer = { id: string; tax_id: string };

/** Da de alta (o actualiza) al cliente en Facturapi y devuelve su id. */
export async function ensureFacturaClient(prisma: PrismaClient, clientId: string, fetchImpl: Fetch = fetch) {
  const cfg = facturaConfig();
  if (!cfg) throw new FacturaError("Falta configurar Facturapi");
  const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const missing = missingFiscal(c);
  if (missing.length) throw new FacturaError(`Faltan datos fiscales del cliente: ${missing.join(", ")}`);
  const rfc = c.rfc!.trim().toUpperCase();
  const prefix = cfg.sandbox ? "test:" : "live:";
  const body = {
    legal_name: cleanLegalName(c.legalName!),
    tax_id: rfc,
    tax_system: c.taxRegime!.trim(),
    email: c.email!.trim(),
    address: { zip: c.taxZip!.trim(), country: "MEX" },
    default_invoice_use: c.cfdiUse!.trim().toUpperCase(),
    external_id: c.publicId,
  };
  let id = c.billingCustomerId?.startsWith(prefix) ? c.billingCustomerId.slice(prefix.length) : null;
  if (!id) {
    const found = await fapi<{ data?: FapiCustomer[] }>(`/customers?q=${encodeURIComponent(rfc)}`, {}, fetchImpl).catch(() => null);
    id = found?.data?.find((x) => x.tax_id?.toUpperCase() === rfc)?.id ?? null;
  }
  const r = id
    ? await fapi<FapiCustomer>(`/customers/${id}`, { method: "PUT", body: JSON.stringify(body) }, fetchImpl)
    : await fapi<FapiCustomer>("/customers", { method: "POST", body: JSON.stringify(body) }, fetchImpl);
  if (!r.id) throw new FacturaError("Facturapi no devolvió el cliente");
  if (c.billingCustomerId !== prefix + r.id) await prisma.client.update({ where: { id: c.id }, data: { billingCustomerId: prefix + r.id } });
  return r.id;
}

// ── Facturas ──

export function formaPagoFor(method: PaymentMethod, s: InvoiceSettings) {
  if (method === "MERCADOPAGO") return s.formaPagoTarjeta;
  if (method === "CASH") return "01";
  return "03"; // transferencia (y «otro» por omisión)
}

const OPEN = ["PENDING", "ISSUED"] as const;

/**
 * Crea la factura de un pago aplicado y la timbra. Una sola factura vigente por pago (las fallidas o
 * canceladas no cuentan).
 */
export async function invoicePayment(
  prisma: PrismaClient,
  paymentId: string,
  opts: { requestedBy: "auto" | "cliente" | "admin"; actorUserId?: string; fetchImpl?: Fetch },
) {
  const cfg = facturaConfig();
  if (!cfg) throw new FacturaError("Falta configurar Facturapi");
  const s = await getInvoiceSettings(prisma);
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.status !== "APPLIED" || !p.clientId) throw new FacturaError("Solo se facturan pagos aplicados a un cliente");
    if (p.source === "IMPORT") throw new FacturaError("Los pagos del sistema anterior no se facturan desde aquí");
    const open = await tx.invoice.findFirst({ where: { paymentId, status: { in: [...OPEN] } } });
    if (open) return { invoice: open, existed: true };
    const invoice = await tx.invoice.create({
      data: { clientId: p.clientId, paymentId, total: p.amount, status: "PENDING", paymentForm: formaPagoFor(p.method, s), sandbox: cfg.sandbox, requestedBy: opts.requestedBy, series: s.serie },
    });
    return { invoice, existed: false };
  });
  if (created.existed) return created.invoice;
  return issueInvoice(prisma, created.invoice.id, { actorUserId: opts.actorUserId, fetchImpl: opts.fetchImpl });
}

type FapiInvoice = { id: string; uuid?: string; status?: string; series?: string; folio_number?: number | string; total?: number; stamp?: { date?: string } | null };

/** Timbra una factura pendiente (o reintenta una fallida). Idempotente por el id de la factura. */
export async function issueInvoice(prisma: PrismaClient, invoiceId: string, opts: { actorUserId?: string; fetchImpl?: Fetch } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const s = await getInvoiceSettings(prisma);
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payment: true, client: { select: { name: true, publicId: true, cfdiUse: true, email: true } } } });
  if (inv.status === "ISSUED" || inv.status === "CANCELLED") return inv;
  try {
    const customer = await ensureFacturaClient(prisma, inv.clientId, fetchImpl);
    const when = inv.payment ? new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric" }).format(inv.payment.receivedAt) : "";
    const body = {
      customer,
      items: [
        {
          quantity: 1,
          product: {
            description: `${s.descripcion}${when ? ` (pago del ${when}${inv.payment?.reference ? `, ref. ${inv.payment.reference}` : ""})` : ""}`.slice(0, 1000),
            product_key: s.claveProdServ,
            unit_key: s.claveUnidad,
            unit_name: s.unidad,
            price: Number(inv.total),
            tax_included: s.preciosConIva,
            taxes: [{ type: "IVA", rate: 0.16 }],
            sku: inv.client.publicId.toUpperCase(),
          },
        },
      ],
      use: inv.client.cfdiUse!.trim().toUpperCase(),
      payment_form: inv.paymentForm ?? "03",
      payment_method: "PUE",
      currency: "MXN",
      ...(s.serie ? { series: s.serie } : {}),
      external_id: inv.id,
      // Un reintento con la misma llave no vuelve a timbrar.
      idempotency_key: inv.id,
    };
    const r = await fapi<FapiInvoice>("/invoices", { method: "POST", body: JSON.stringify(body) }, fetchImpl);
    if (r.status && r.status !== "valid") throw new FacturaError(`Facturapi devolvió la factura en estado «${r.status}»`, r);
    const done = await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: "ISSUED",
        uuid: r.uuid ?? null,
        providerUid: r.id,
        series: r.series ?? s.serie,
        folio: r.folio_number != null ? String(r.folio_number) : null,
        issuedAt: r.stamp?.date ? new Date(r.stamp.date) : new Date(),
        total: r.total ?? inv.total,
        error: null,
      },
    });
    if (s.enviarCorreo && inv.client.email) {
      await fapi(`/invoices/${r.id}/email`, { method: "POST", body: JSON.stringify({ email: inv.client.email }) }, fetchImpl).catch(() => null);
    }
    await audit(prisma, { actorUserId: opts.actorUserId, action: "invoice.issued", entity: "Invoice", entityId: inv.id, summary: `Factura ${done.series ?? ""}${done.folio ?? ""} timbrada${inv.sandbox ? " (pruebas)" : ""} a ${inv.client.name} por $${done.total}` });
    return done;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "FAILED", error: msg } });
    throw e instanceof FacturaError ? e : new FacturaError(msg);
  }
}

/** Cancela ante el SAT (motivo 02 errores sin relación, 03 operación no realizada). */
export async function cancelInvoice(prisma: PrismaClient, invoiceId: string, motivo: "02" | "03", actorUserId: string, fetchImpl: Fetch = fetch) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status !== "ISSUED" || !inv.providerUid) throw new FacturaError("Solo se cancelan facturas timbradas");
  const r = await fapi<{ status?: string; cancellation_status?: string }>(`/invoices/${inv.providerUid}?motive=${motivo}`, { method: "DELETE" }, fetchImpl);
  // Si el receptor debe aceptar la cancelación, queda «pendiente» en el SAT; se marca y se guarda el detalle.
  const accepted = r.status === "canceled";
  const done = await prisma.invoice.update({
    where: { id: inv.id },
    data: accepted ? { status: "CANCELLED", cancelReason: motivo, cancelledAt: new Date() } : { cancelReason: motivo, error: `Cancelación solicitada; estado SAT: ${r.cancellation_status ?? r.status ?? "pendiente"}` },
  });
  await audit(prisma, { actorUserId, action: "invoice.cancelled", entity: "Invoice", entityId: inv.id, summary: `Cancelación de la factura ${inv.series ?? ""}${inv.folio ?? ""} (motivo ${motivo}): ${accepted ? "cancelada" : "pendiente de aceptación"}` });
  return done;
}

/** PDF o XML de una factura, directo de Facturapi. */
export async function invoiceFile(prisma: PrismaClient, invoiceId: string, kind: "pdf" | "xml", fetchImpl: Fetch = fetch) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (!inv.providerUid) throw new FacturaError("La factura no está timbrada");
  const res = await fapi<Response>(`/invoices/${inv.providerUid}/${kind}`, { raw: true }, fetchImpl);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType: kind === "pdf" ? "application/pdf" : "application/xml", filename: `factura-${inv.series ?? ""}${inv.folio ?? inv.id}.${kind}` };
}

/** El cliente pide la factura de uno de sus pagos (dentro del plazo configurado). */
export async function requestClientInvoice(prisma: PrismaClient, clientId: string, paymentId: string, actorUserId: string, fetchImpl: Fetch = fetch) {
  const s = await getInvoiceSettings(prisma);
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.clientId !== clientId) throw new FacturaError("Pago no encontrado");
  if (Date.now() - p.receivedAt.getTime() > s.diasSolicitud * 86_400_000) throw new FacturaError(`Solo se pueden pedir facturas de pagos de los últimos ${s.diasSolicitud} días; pídela a Packatelas`);
  return invoicePayment(prisma, paymentId, { requestedBy: "cliente", actorUserId, fetchImpl });
}

/** Worker: factura en automático los pagos nuevos de clientes con «Facturar en automático». */
export async function autoInvoicePayments(prisma: PrismaClient, limit = 20, fetchImpl: Fetch = fetch) {
  const s = await getInvoiceSettings(prisma);
  if (!s.autoEnabled || !s.enabledAt || !facturaConfig()) return { issued: 0, failed: 0 };
  const pays = await prisma.payment.findMany({
    where: { status: "APPLIED", source: { not: "IMPORT" }, receivedAt: { gte: new Date(s.enabledAt) }, client: { autoInvoice: true }, invoices: { none: {} } },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let issued = 0, failed = 0;
  for (const p of pays) {
    try {
      const inv = await invoicePayment(prisma, p.id, { requestedBy: "auto", fetchImpl });
      if (inv.status === "ISSUED") issued++;
    } catch {
      failed++;
    }
  }
  return { issued, failed };
}
