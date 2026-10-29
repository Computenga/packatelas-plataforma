// Facturación electrónica CFDI 4.0 con factura.com [I05, I10].
// - Cada pago aplicado (transferencia o tarjeta) se puede facturar: en automático para los clientes
//   con «Facturar en automático», o a solicitud del cliente desde su portal, o desde administración.
// - CFDI de ingreso PUE por el monto pagado; precio con IVA incluido por omisión (configurable).
// - Entorno de pruebas (sandbox) por omisión: FACTURACOM_ENTORNO=produccion para timbrar real.
// - El cliente se da de alta en factura.com por RFC la primera vez y se reutiliza su UID.
import type { Prisma, PrismaClient, PaymentMethod } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;
type Fetch = typeof fetch;
const KEY = "facturacion";
/** Encabezado fijo que factura.com pide a las integraciones por API. */
const F_PLUGIN = "9d4095c8f7ed5785cb14c0e3b033eeb8252416ed";

export type InvoiceSettings = {
  autoEnabled: boolean;
  enabledAt: string | null;
  serieId: number | null;
  serieName: string | null;
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
  serieId: null,
  serieName: null,
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
  const apiKey = process.env.FACTURACOM_API_KEY?.trim();
  const secret = process.env.FACTURACOM_SECRET_KEY?.trim();
  if (!apiKey || !secret) return null;
  const sandbox = (process.env.FACTURACOM_ENTORNO ?? "").trim().toLowerCase() !== "produccion";
  return { base: sandbox ? "https://sandbox.factura.com/api" : "https://api.factura.com", sandbox, apiKey, secret };
}

export async function getInvoiceSettings(db: Db): Promise<InvoiceSettings> {
  const r = await db.setting.findUnique({ where: { key: KEY } });
  return { ...DEFAULTS, ...((r?.value as Partial<InvoiceSettings> | undefined) ?? {}) };
}

export async function saveInvoiceSettings(db: Db, patch: Partial<InvoiceSettings>, actorUserId: string) {
  const cur = await getInvoiceSettings(db);
  const next = { ...cur, ...patch };
  if (!/^\d{8}$/.test(next.claveProdServ)) throw new Error("La clave de producto o servicio SAT son 8 dígitos");
  if (!/^[A-Z0-9]{2,3}$/.test(next.claveUnidad)) throw new Error("Clave de unidad SAT inválida");
  if (!/^\d{2}$/.test(next.formaPagoTarjeta)) throw new Error("Forma de pago inválida");
  if (!next.descripcion.trim()) throw new Error("Falta la descripción");
  if (next.autoEnabled && !next.serieId) throw new Error("Elige la serie antes de encender la facturación automática");
  if (next.autoEnabled && !cur.autoEnabled) next.enabledAt = new Date().toISOString();
  await db.setting.upsert({ where: { key: KEY }, update: { value: next }, create: { key: KEY, value: next } });
  await audit(db, { actorUserId, action: "facturacion.settings", entity: "Setting", entityId: KEY, summary: `Facturación automática ${next.autoEnabled ? "ENCENDIDA" : "apagada"}; serie ${next.serieName ?? "—"}; clave ${next.claveProdServ}` });
  return next;
}

// ── Llamadas a factura.com ──

export class FacturaError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
  }
}

/** Convierte cualquier forma de error de factura.com en un texto legible. */
function errorText(j: unknown): string {
  if (!j || typeof j !== "object") return String(j ?? "Error desconocido");
  const o = j as Record<string, unknown>;
  const m = o.message;
  if (typeof m === "string") return m;
  if (m && typeof m === "object") {
    const mm = m as Record<string, unknown>;
    if (typeof mm.message === "string") return [mm.message, mm.messageDetail].filter(Boolean).join(" · ");
    return Object.entries(mm).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ");
  }
  return JSON.stringify(j).slice(0, 300);
}

async function fc<T = Record<string, unknown>>(path: string, init: RequestInit & { raw?: boolean } = {}, fetchImpl: Fetch = fetch): Promise<T> {
  const cfg = facturaConfig();
  if (!cfg) throw new FacturaError("Falta configurar factura.com (FACTURACOM_API_KEY y FACTURACOM_SECRET_KEY)");
  const res = await fetchImpl(`${cfg.base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "F-PLUGIN": F_PLUGIN, "F-Api-Key": cfg.apiKey, "F-Secret-Key": cfg.secret, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(45_000),
  });
  if (init.raw) return res as unknown as T;
  const text = await res.text();
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new FacturaError(`factura.com respondió ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new FacturaError(`factura.com ${res.status}: ${errorText(j)}`, j);
  return j as T;
}

export async function listFacturaSeries(fetchImpl: Fetch = fetch) {
  const j = await fc<{ data?: { SerieID: number; SerieName: string; SerieType: string; SerieDescription?: string; SerieStatus?: string }[] }>("/v4/series", {}, fetchImpl);
  return (j.data ?? []).filter((s) => s.SerieType === "factura" && (!s.SerieStatus || /activ/i.test(s.SerieStatus)));
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

/** Quita el régimen societario del nombre (factura.com y el SAT lo piden sin «S.A. de C.V.»). */
export function cleanLegalName(name: string) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[,\s]+(S\.?\s?A\.?\s?P\.?\s?I\.?|S\.?\s?A\.?|S\.?\s?DE\s?R\.?\s?L\.?|S\.?\s?C\.?|A\.?\s?C\.?|S\.?\s?A\.?\s?S\.?)(\s+DE\s+C\.?\s?V\.?)?\.?$/i, "")
    .trim();
}

/** Da de alta (o actualiza) al cliente en factura.com y devuelve su UID. */
export async function ensureFacturaClient(prisma: PrismaClient, clientId: string, fetchImpl: Fetch = fetch) {
  const cfg = facturaConfig();
  if (!cfg) throw new FacturaError("Falta configurar factura.com");
  const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const missing = missingFiscal(c);
  if (missing.length) throw new FacturaError(`Faltan datos fiscales del cliente: ${missing.join(", ")}`);
  const rfc = c.rfc!.trim().toUpperCase();
  const prefix = cfg.sandbox ? "sbx:" : "prd:";
  const body = {
    rfc,
    razons: cleanLegalName(c.legalName!),
    codpos: Number(c.taxZip),
    email: c.email!.trim(),
    regimen: c.taxRegime!.trim(),
    usocfdi: c.cfdiUse!.trim().toUpperCase(),
    pais: "MEX",
  };
  let uid = c.fcClientUid?.startsWith(prefix) ? c.fcClientUid.slice(prefix.length) : null;
  if (!uid) {
    const found = await fc<{ status?: string; Data?: { UID?: string } }>(`/v1/clients/${encodeURIComponent(rfc)}`, {}, fetchImpl).catch(() => null);
    uid = found?.status === "success" ? (found.Data?.UID ?? null) : null;
  }
  const r = uid
    ? await fc<{ status?: string; Data?: { UID?: string } }>(`/v1/clients/${uid}/update`, { method: "POST", body: JSON.stringify(body) }, fetchImpl)
    : await fc<{ status?: string; Data?: { UID?: string } }>("/v1/clients/create", { method: "POST", body: JSON.stringify(body) }, fetchImpl);
  if (r.status !== "success" || !r.Data?.UID) throw new FacturaError(`No se pudo registrar al cliente en factura.com: ${errorText(r)}`, r);
  if (c.fcClientUid !== prefix + r.Data.UID) await prisma.client.update({ where: { id: c.id }, data: { fcClientUid: prefix + r.Data.UID } });
  return r.Data.UID;
}

// ── Facturas ──

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Desglose del concepto: base e IVA que suman exacto el total pagado. */
export function splitIva(total: number, preciosConIva: boolean, rate = 0.16) {
  if (preciosConIva) {
    const base = r2(total / (1 + rate));
    return { base, iva: r2(total - base), total: r2(total) };
  }
  const iva = r2(total * rate);
  return { base: r2(total), iva, total: r2(total + iva) };
}

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
  if (!cfg) throw new FacturaError("Falta configurar factura.com");
  const s = await getInvoiceSettings(prisma);
  if (!s.serieId) throw new FacturaError("Falta elegir la serie de facturación");
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.status !== "APPLIED" || !p.clientId) throw new FacturaError("Solo se facturan pagos aplicados a un cliente");
    const open = await tx.invoice.findFirst({ where: { paymentId, status: { in: [...OPEN] } } });
    if (open) return { invoice: open, existed: true };
    const invoice = await tx.invoice.create({
      data: { clientId: p.clientId, paymentId, total: p.amount, status: "PENDING", paymentForm: formaPagoFor(p.method, s), sandbox: cfg.sandbox, requestedBy: opts.requestedBy, series: s.serieName },
    });
    return { invoice, existed: false };
  });
  if (created.existed) return created.invoice;
  return issueInvoice(prisma, created.invoice.id, { actorUserId: opts.actorUserId, fetchImpl: opts.fetchImpl });
}

/** Timbra una factura pendiente (o reintenta una fallida). */
export async function issueInvoice(prisma: PrismaClient, invoiceId: string, opts: { actorUserId?: string; fetchImpl?: Fetch } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const s = await getInvoiceSettings(prisma);
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payment: true, client: { select: { name: true, publicId: true } } } });
  if (inv.status === "ISSUED" || inv.status === "CANCELLED") return inv;
  try {
    const uid = await ensureFacturaClient(prisma, inv.clientId, fetchImpl);
    const t = splitIva(Number(inv.total), s.preciosConIva);
    const when = inv.payment ? new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric" }).format(inv.payment.receivedAt) : "";
    const body = {
      Receptor: { UID: uid },
      TipoDocumento: "factura",
      Conceptos: [
        {
          ClaveProdServ: s.claveProdServ,
          NoIdentificacion: inv.client.publicId.toUpperCase(),
          Cantidad: 1,
          ClaveUnidad: s.claveUnidad,
          Unidad: s.unidad,
          ValorUnitario: t.base,
          Descripcion: `${s.descripcion}${when ? ` (pago del ${when}${inv.payment?.reference ? `, ref. ${inv.payment.reference}` : ""})` : ""}`.slice(0, 1000),
          ObjetoImp: "02",
          Impuestos: { Traslados: [{ Base: t.base, Impuesto: "002", TipoFactor: "Tasa", TasaOCuota: "0.16", Importe: t.iva }] },
        },
      ],
      UsoCFDI: (await prisma.client.findUniqueOrThrow({ where: { id: inv.clientId }, select: { cfdiUse: true } })).cfdiUse!.trim().toUpperCase(),
      Serie: s.serieId,
      FormaPago: inv.paymentForm ?? "03",
      MetodoPago: "PUE",
      Moneda: "MXN",
      EnviarCorreo: s.enviarCorreo,
      NumOrder: inv.id,
    };
    const r = await fc<{ response?: string; UUID?: string; uid?: string; invoice_uid?: string; INV?: { Serie?: string; Folio?: string | number }; SAT?: { UUID?: string; FechaTimbrado?: string } }>(
      "/v4/cfdi40/create",
      { method: "POST", body: JSON.stringify(body) },
      fetchImpl,
    );
    if (r.response !== "success") throw new FacturaError(errorText(r), r);
    const done = await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: "ISSUED",
        uuid: r.UUID ?? r.SAT?.UUID ?? null,
        providerUid: r.uid ?? r.invoice_uid ?? null,
        series: r.INV?.Serie ?? s.serieName,
        folio: r.INV?.Folio != null ? String(r.INV.Folio) : null,
        issuedAt: r.SAT?.FechaTimbrado ? new Date(r.SAT.FechaTimbrado) : new Date(),
        total: t.total,
        error: null,
      },
    });
    await audit(prisma, { actorUserId: opts.actorUserId, action: "invoice.issued", entity: "Invoice", entityId: inv.id, summary: `Factura ${done.series ?? ""}${done.folio ?? ""} timbrada${inv.sandbox ? " (pruebas)" : ""} a ${inv.client.name} por $${t.total}` });
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
  const r = await fc<{ response?: string; message?: unknown }>(`/v4/cfdi40/${inv.providerUid}/cancel`, { method: "POST", body: JSON.stringify({ motivo, folioSustituto: "" }) }, fetchImpl);
  if (r.response !== "success") throw new FacturaError(errorText(r), r);
  const done = await prisma.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED", cancelReason: motivo, cancelledAt: new Date() } });
  await audit(prisma, { actorUserId, action: "invoice.cancelled", entity: "Invoice", entityId: inv.id, summary: `Factura ${inv.series ?? ""}${inv.folio ?? ""} cancelada (motivo ${motivo})` });
  return done;
}

/** PDF o XML de una factura, directo de factura.com. */
export async function invoiceFile(prisma: PrismaClient, invoiceId: string, kind: "pdf" | "xml", fetchImpl: Fetch = fetch) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (!inv.providerUid) throw new FacturaError("La factura no está timbrada");
  const res = await fc<Response>(`/v4/cfdi40/${inv.providerUid}/${kind}`, { raw: true }, fetchImpl);
  if (!res.ok) throw new FacturaError(`factura.com respondió ${res.status} al descargar el ${kind.toUpperCase()}`);
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
    where: { status: "APPLIED", receivedAt: { gte: new Date(s.enabledAt) }, client: { autoInvoice: true }, invoices: { none: {} } },
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
