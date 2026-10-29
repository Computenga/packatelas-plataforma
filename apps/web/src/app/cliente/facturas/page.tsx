import type { Metadata } from "next";
import { facturaConfig, getInvoiceSettings, missingFiscal, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Card } from "@/components/ui";
import { ActButton } from "@/app/admin/cobros/facturacion/buttons";
import { requestInvoiceAction, saveFiscalAction } from "./actions";

/** Hora de la consulta (fuera del componente: la página se arma una vez por petición). */
const requestTime = () => Date.now();

export const metadata: Metadata = { title: "Facturas" };

const REGIMENES = [
  ["601", "General de Ley Personas Morales"], ["603", "Personas Morales con Fines no Lucrativos"], ["605", "Sueldos y Salarios"], ["606", "Arrendamiento"],
  ["612", "Personas Físicas con Actividades Empresariales y Profesionales"], ["616", "Sin obligaciones fiscales"], ["621", "Incorporación Fiscal"],
  ["625", "Actividades Empresariales con ingresos a través de Plataformas Tecnológicas"], ["626", "Régimen Simplificado de Confianza (RESICO)"],
] as const;
const USOS = [["G03", "Gastos en general"], ["G01", "Adquisición de mercancías"], ["S01", "Sin efectos fiscales"], ["CP01", "Pagos"]] as const;

export default async function FacturasPage() {
  const { clientId } = await requireClient();
  const s = await getInvoiceSettings(prisma);
  const since = new Date(requestTime() - s.diasSolicitud * 86_400_000);
  const [c, invoices, payments] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { rfc: true, legalName: true, taxRegime: true, taxZip: true, cfdiUse: true, email: true, autoInvoice: true } }),
    prisma.invoice.findMany({ where: { clientId, status: { in: ["ISSUED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.payment.findMany({ where: { clientId, status: "APPLIED", receivedAt: { gte: since }, invoices: { none: { status: { in: ["PENDING", "ISSUED"] } } } }, orderBy: { receivedAt: "desc" } }),
  ]);
  const missing = missingFiscal(c);
  const ready = !!facturaConfig() && !!s.serieId;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Facturas</h1>

      <Card title="Mis datos fiscales">
        {missing.length > 0 && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Para facturar falta: {missing.join(", ")}. Cópialos de tu Constancia de Situación Fiscal.</p>}
        <ActionForm key={[c.rfc, c.taxRegime, c.cfdiUse, c.taxZip, c.legalName, c.email].join("|")} action={saveFiscalAction} submitLabel="Guardar datos fiscales">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">RFC<input name="rfc" defaultValue={c.rfc ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 uppercase" /></label>
            <label className="text-sm">Código postal fiscal<input name="taxZip" inputMode="numeric" defaultValue={c.taxZip ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          </div>
          <label className="block text-sm">Razón social (sin «S.A. de C.V.»)<input name="legalName" defaultValue={c.legalName ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Régimen fiscal
              <select name="taxRegime" defaultValue={c.taxRegime ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">— Elige —</option>
                {REGIMENES.map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}
                {c.taxRegime && !REGIMENES.some(([k]) => k === c.taxRegime) && <option value={c.taxRegime}>{c.taxRegime}</option>}
              </select>
            </label>
            <label className="text-sm">Uso de CFDI
              <select name="cfdiUse" defaultValue={c.cfdiUse ?? "G03"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                {USOS.map(([k, l]) => <option key={k} value={k}>{k} · {l}</option>)}
                {c.cfdiUse && !USOS.some(([k]) => k === c.cfdiUse) && <option value={c.cfdiUse}>{c.cfdiUse}</option>}
              </select>
            </label>
          </div>
          <label className="block text-sm">Correo para recibir las facturas<input name="email" type="email" defaultValue={c.email ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        </ActionForm>
        {c.autoInvoice && <p className="mt-3 text-xs text-slate-500">Tus pagos se facturan en automático.</p>}
      </Card>

      {ready && payments.length > 0 && (
        <Card title="Pagos que puedes facturar">
          <p className="mb-2 text-xs text-slate-500">Pagos de los últimos {s.diasSolicitud} días sin factura.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span>{fecha(p.receivedAt)} · <strong>{mxn(p.amount)}</strong>{p.reference && <span className="text-slate-500"> · {p.reference}</span>}</span>
                {missing.length ? <span className="text-xs text-slate-400">Completa tus datos</span> : <ActButton action={requestInvoiceAction.bind(null, p.id)} label="Facturar" />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Mis facturas">
        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no tienes facturas.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-mono">{i.series ?? ""}{i.folio}</span> · {fecha(i.issuedAt ?? i.createdAt)} · <strong>{mxn(i.total)}</strong>
                  {i.status === "CANCELLED" && <span className="ml-1 text-xs text-red-700">cancelada</span>}
                  {i.sandbox && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">prueba</span>}
                </span>
                <span className="whitespace-nowrap">
                  <a href={`/factura/${i.id}/pdf`} target="_blank" rel="noopener" className="text-brand hover:underline">PDF</a>{" · "}
                  <a href={`/factura/${i.id}/xml`} className="text-brand hover:underline">XML</a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
