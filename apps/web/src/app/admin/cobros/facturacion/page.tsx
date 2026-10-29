import type { Metadata } from "next";
import Link from "next/link";
import { facturaConfig, getInvoiceSettings, listFacturaSeries, missingFiscal, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CobrosTabs } from "../tabs";
import { cancelInvoiceAction, invoicePaymentAction, retryInvoiceAction, saveFacturacionAction } from "./actions";
import { ActButton } from "./buttons";

/** Hora de la consulta (fuera del componente: la página se arma una vez por petición). */
const requestTime = () => Date.now();

export const metadata: Metadata = { title: "Facturación" };

const STATUS = { PENDING: ["Timbrando", "amber"], ISSUED: ["Timbrada", "green"], FAILED: ["Falló", "red"], CANCELLED: ["Cancelada", "gray"] } as const;
const METHOD = { TRANSFER: "Transferencia", MERCADOPAGO: "Tarjeta (MP)", CASH: "Efectivo", OTHER: "Otro" } as const;

export default async function FacturacionPage() {
  await requireUser(["ADMIN"]);
  const cfg = facturaConfig();
  const since = new Date(requestTime() - 60 * 86_400_000);
  const [s, series, invoices, unbilled] = await Promise.all([
    getInvoiceSettings(prisma),
    cfg ? listFacturaSeries().then((x) => ({ ok: true as const, list: x })).catch((e: Error) => ({ ok: false as const, error: e.message, list: [] as Awaited<ReturnType<typeof listFacturaSeries>> })) : Promise.resolve(null),
    prisma.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { client: { select: { id: true, name: true, publicId: true } }, payment: { select: { method: true, receivedAt: true, reference: true } } } }),
    prisma.payment.findMany({
      where: { status: "APPLIED", clientId: { not: null }, receivedAt: { gte: since }, invoices: { none: { status: { in: ["PENDING", "ISSUED"] } } } },
      orderBy: { receivedAt: "desc" },
      take: 100,
      include: { client: { select: { id: true, name: true, publicId: true, rfc: true, legalName: true, taxRegime: true, taxZip: true, cfdiUse: true, email: true, autoInvoice: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Facturación" title="Cobros">Facturas CFDI 4.0 de los pagos de los clientes con factura.com.</PageHeader>
      <CobrosTabs active="facturacion" />

      <Card title="Conexión con factura.com">
        <ul className="space-y-1 text-sm">
          <li>Claves (FACTURACOM_API_KEY y FACTURACOM_SECRET_KEY): {cfg ? <Badge tone="green">configuradas</Badge> : <Badge tone="red">faltan</Badge>}</li>
          <li>
            Entorno: {cfg ? (cfg.sandbox ? <Badge tone="amber">PRUEBAS (sandbox): no timbra real</Badge> : <Badge tone="green">PRODUCCIÓN</Badge>) : "—"}
            <span className="ml-2 text-xs text-slate-500">Para timbrar real: FACTURACOM_ENTORNO=produccion en Coolify.</span>
          </li>
          {series && !series.ok && <li className="text-red-700">factura.com: {series.error}</li>}
          {series?.ok && <li>Series de factura disponibles: {series.list.map((x) => x.SerieName).join(", ") || "ninguna"}</li>}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Las claves se ponen en las variables de entorno del servidor (Coolify), nunca aquí.</p>
      </Card>

      <Card title="Ajustes">
        <ActionForm action={saveFacturacionAction} submitLabel="Guardar">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Serie
              <select name="serie" defaultValue={s.serieId ? `${s.serieId}|${s.serieName ?? ""}` : ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">— Elige —</option>
                {s.serieId && !series?.list.some((x) => x.SerieID === s.serieId) && <option value={`${s.serieId}|${s.serieName ?? ""}`}>{s.serieName ?? s.serieId}</option>}
                {series?.list.map((x) => (
                  <option key={x.SerieID} value={`${x.SerieID}|${x.SerieName}`}>{x.SerieName}{x.SerieDescription ? ` · ${x.SerieDescription}` : ""}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Clave producto/servicio SAT
              <input name="claveProdServ" defaultValue={s.claveProdServ} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              Clave de unidad SAT · nombre
              <div className="mt-1 flex gap-2">
                <input name="claveUnidad" defaultValue={s.claveUnidad} className="w-20 rounded-lg border border-slate-300 px-3 py-2" />
                <input name="unidad" defaultValue={s.unidad} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              </div>
            </label>
          </div>
          <label className="block text-sm">
            Descripción del concepto
            <input name="descripcion" defaultValue={s.descripcion} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Forma de pago para tarjeta (Mercado Pago)
              <select name="formaPagoTarjeta" defaultValue={s.formaPagoTarjeta} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="04">04 · Tarjeta de crédito</option>
                <option value="28">28 · Tarjeta de débito</option>
              </select>
            </label>
            <label className="text-sm">
              Días para que el cliente pida factura
              <input name="diasSolicitud" type="number" min="1" max="90" defaultValue={s.diasSolicitud} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="preciosConIva" defaultChecked={s.preciosConIva} /> El monto pagado ya incluye IVA (se desglosa 16 %)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="enviarCorreo" defaultChecked={s.enviarCorreo} /> factura.com envía la factura al correo del cliente</label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="autoEnabled" defaultChecked={s.autoEnabled} /> Facturar en automático los pagos nuevos de clientes con «Facturar en automático»
              <Badge tone={s.autoEnabled ? "green" : "gray"}>{s.autoEnabled ? "encendido" : "apagado"}</Badge>
            </label>
          </div>
          <p className="text-xs text-slate-500">Todas las facturas son CFDI de ingreso PUE (una por pago recibido), forma de pago 03 para transferencias. Confirma la clave de producto, la descripción y el tratamiento de anticipos con tu contador.</p>
        </ActionForm>
      </Card>

      <Card title="Pagos sin factura (últimos 60 días)">
        {unbilled.length === 0 ? (
          <p className="text-sm text-slate-500">Todos los pagos recientes tienen factura.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Recibido</th><th>Cliente</th><th>Método</th><th className="text-right">Monto</th><th>Datos fiscales</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {unbilled.map((p) => {
                const miss = p.client ? missingFiscal(p.client) : ["cliente"];
                return (
                  <tr key={p.id} className="align-top">
                    <td className="py-1.5">{fecha(p.receivedAt)}</td>
                    <td><Link href={`/admin/clientes/${p.client!.id}`} className="hover:underline">{p.client!.publicId.toUpperCase()} · {p.client!.name}</Link>{p.client!.autoInvoice && <span className="ml-1 text-xs text-slate-500">(auto)</span>}</td>
                    <td>{METHOD[p.method]}</td>
                    <td className="text-right">{mxn(p.amount)}</td>
                    <td>{miss.length ? <span className="text-xs text-amber-700">Falta: {miss.join(", ")}</span> : <span className="text-xs text-emerald-700">{p.client!.rfc}</span>}</td>
                    <td className="text-right">{!miss.length && cfg && <ActButton action={invoicePaymentAction.bind(null, p.id)} label="Facturar" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Facturas">
        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay facturas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Fecha</th><th>Folio</th><th>Cliente</th><th className="text-right">Total</th><th>Estado</th><th>Archivos</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((i) => (
                <tr key={i.id} className="align-top">
                  <td className="py-1.5">{fecha(i.issuedAt ?? i.createdAt)}</td>
                  <td className="font-mono text-xs">{i.series ?? ""}{i.folio ?? "—"}{i.sandbox && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">prueba</span>}</td>
                  <td>{i.client.publicId.toUpperCase()} · {i.client.name}<span className="block text-xs text-slate-500">{i.requestedBy === "auto" ? "automática" : i.requestedBy === "cliente" ? "la pidió el cliente" : "administración"}</span></td>
                  <td className="text-right">{mxn(i.total)}</td>
                  <td>
                    <Badge tone={STATUS[i.status][1]}>{STATUS[i.status][0]}</Badge>
                    {i.error && i.status === "FAILED" && <span className="mt-1 block max-w-xs text-xs text-red-700">{i.error}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {i.providerUid ? (
                      <>
                        <a href={`/factura/${i.id}/pdf`} target="_blank" rel="noopener" className="text-brand hover:underline">PDF</a>{" · "}
                        <a href={`/factura/${i.id}/xml`} className="text-brand hover:underline">XML</a>
                      </>
                    ) : "—"}
                  </td>
                  <td>
                    {i.status === "FAILED" && <ActButton action={retryInvoiceAction.bind(null, i.id)} label="Reintentar" />}
                    {i.status === "ISSUED" && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-slate-500">Cancelar…</summary>
                        <ActionForm action={cancelInvoiceAction.bind(null, i.id)} submitLabel="Cancelar ante el SAT" className="mt-2 w-56">
                          <select name="motivo" className="w-full rounded border border-slate-300 px-2 py-1">
                            <option value="02">02 · Errores sin relación</option>
                            <option value="03">03 · No se llevó a cabo</option>
                          </select>
                          <input name="confirm" placeholder="Escribe CANCELAR" className="w-full rounded border border-slate-300 px-2 py-1" />
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
