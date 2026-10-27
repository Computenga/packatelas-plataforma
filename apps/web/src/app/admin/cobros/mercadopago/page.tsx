import type { Metadata } from "next";
import Link from "next/link";
import { describeTiers, getMpSettings, mpConfigured, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CobrosTabs } from "../tabs";
import { saveMpAction } from "./actions";

export const metadata: Metadata = { title: "Mercado Pago" };

const STATUS = { PENDING: "Abierto", APPROVED: "Aprobado", REJECTED: "Rechazado", EXPIRED: "Vencido", REFUNDED: "Devuelto" } as const;

export default async function MercadoPagoPage() {
  await requireUser(["ADMIN"]);
  const [s, list] = await Promise.all([
    getMpSettings(prisma),
    prisma.mpCheckout.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { client: { select: { id: true, name: true, publicId: true } } } }),
  ]);
  const token = mpConfigured();
  const secret = !!process.env.MP_WEBHOOK_SECRET?.trim();
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Facturación" title="Cobros">Pago de saldo con tarjeta desde el portal del cliente.</PageHeader>
      <CobrosTabs active="mercadopago" />

      <Card title="Conexión">
        <ul className="space-y-1 text-sm">
          <li>Access token de producción (MP_ACCESS_TOKEN): {token ? <Badge tone="green">configurado</Badge> : <Badge tone="red">falta</Badge>}</li>
          <li>Clave secreta de avisos (MP_WEBHOOK_SECRET): {secret ? <Badge tone="green">configurada</Badge> : <Badge tone="red">falta</Badge>}</li>
          <li>
            URL de avisos para Mercado Pago (Webhooks → evento «Pagos»): <code className="rounded bg-slate-100 px-1">{base || "(falta PUBLIC_URL)"}/api/mp/webhook</code>
          </li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">Las claves se ponen en las variables de entorno del servidor (Coolify), nunca aquí.</p>
      </Card>

      <Card title="Ajustes">
        <ActionForm action={saveMpAction} submitLabel="Guardar">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Mostrar «Pagar con tarjeta» en el portal del cliente
          </label>
          <div>
            <p className="text-sm font-medium">Comisión por tramos del abono</p>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="pb-1 font-normal">Abonos hasta ($, incluido)</th><th className="pb-1 font-normal">Porcentaje (%)</th><th className="pb-1 font-normal">Fijo ($)</th></tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4].map((i) => {
                  const t = s.tiers[i];
                  return (
                    <tr key={i}>
                      <td className="pr-2 pb-2"><input name={`upTo${i}`} type="number" step="0.01" min="0" defaultValue={t?.upTo ?? ""} placeholder={t && t.upTo == null ? "en adelante" : i < s.tiers.length ? "" : "—"} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></td>
                      <td className="pr-2 pb-2"><input name={`percent${i}`} type="number" step="0.01" min="0" defaultValue={t?.percent ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></td>
                      <td className="pb-2"><input name={`fixed${i}`} type="number" step="0.01" min="0" defaultValue={t?.fixed ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">Deja el límite vacío en el último tramo para «en adelante». Filas vacías se ignoran. Ahora: {describeTiers(s.tiers)}.</p>
          </div>
          <label className="block text-sm sm:w-1/3">
            Abono mínimo ($)
            <input name="minAmount" type="number" step="1" min="10" defaultValue={s.minAmount} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <p className="text-xs text-slate-500">La comisión se suma al total que paga el cliente; a su saldo se abona solo el monto que eligió. Pon 0 para absorberla.</p>
        </ActionForm>
      </Card>

      <Card title="Pagos con tarjeta recientes">
        {list.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay pagos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="py-1">Fecha</th><th>Cliente</th><th className="text-right">Abono</th><th className="text-right">Comisión</th><th>Estado</th><th>MP</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="py-1">{fecha(c.createdAt)}</td>
                  <td><Link href={`/admin/cobros/${c.client.id}`} className="hover:underline">{c.client.publicId.toUpperCase()} · {c.client.name}</Link></td>
                  <td className="text-right">{mxn(c.amount)}</td>
                  <td className="text-right">{mxn(c.fee)}</td>
                  <td><Badge tone={c.status === "APPROVED" ? "green" : c.status === "PENDING" ? "amber" : c.status === "REFUNDED" ? "red" : "gray"}>{STATUS[c.status]}</Badge>{c.detail && <span className="ml-1 text-xs text-slate-500">{c.detail}</span>}</td>
                  <td className="font-mono text-xs">{c.mpPaymentId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
