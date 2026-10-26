import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { approveAction, rejectAction } from "./actions";

export const metadata: Metadata = { title: "Solicitudes de registro" };

export default async function SolicitudesPage() {
  await requireUser(["ADMIN"]);
  const [pending, recent] = await Promise.all([
    prisma.clientSignup.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } }),
    prisma.clientSignup.findMany({ where: { status: { not: "PENDING" } }, orderBy: { reviewedAt: "desc" }, take: 20 }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Clientes" title="Solicitudes de registro">
        Tiendas que se registraron en <Link href="/registro" className="text-brand hover:underline" target="_blank">/registro</Link>. Al aprobar se crea el cliente con su ID, la sucursal y su acceso al portal.
      </PageHeader>

      {pending.length === 0 && <Card><p className="text-sm text-slate-500">No hay solicitudes pendientes.</p></Card>}

      {pending.map((s) => (
        <Card key={s.id} title={s.businessName} actions={<span className="text-xs text-slate-500">{fecha(s.createdAt)}</span>}>
          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Contacto</dt><dd>{s.contactName}</dd>
              <dt className="text-slate-500">WhatsApp</dt>
              <dd><a className="text-brand hover:underline" href={`https://wa.me/52${s.phone.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noreferrer">{s.phone}</a></dd>
              <dt className="text-slate-500">Correo</dt><dd>{s.email}</dd>
              <dt className="text-slate-500">Recolección</dt>
              <dd>{s.zone === "emx" ? "Edomex" : "CDMX"} · {s.pickupAddress}{s.pickupReference && <span className="text-slate-500"> ({s.pickupReference})</span>}</dd>
              <dt className="text-slate-500">Envíos al mes</dt><dd>{s.monthlyVolume ?? "—"}</dd>
              <dt className="text-slate-500">Vende en</dt><dd>{s.salesChannels || "—"}</dd>
              <dt className="text-slate-500">Facturación</dt><dd>{s.rfc ? `${s.rfc} · ${s.legalName ?? ""}` : "—"}</dd>
              <dt className="text-slate-500">Usuario</dt><dd className="font-mono text-xs">{s.username}</dd>
            </dl>
            <div className="space-y-4">
              <ActionForm action={approveAction.bind(null, s.id)} submitLabel="Aprobar y crear cliente">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm">
                    <span className="text-slate-600">Zona del ID</span>
                    <select name="zone" defaultValue={s.zone} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2">
                      <option value="cmx">cmx (CDMX)</option>
                      <option value="emx">emx (Edomex)</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="text-slate-600">Tarifa</span>
                    <input name="tariffAmount" type="number" step="0.01" min="0" defaultValue="115" required className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2" />
                  </label>
                </div>
              </ActionForm>
              <ActionForm action={rejectAction.bind(null, s.id)} submitLabel="Rechazar">
                <input name="note" placeholder="Motivo (opcional)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </ActionForm>
            </div>
          </div>
        </Card>
      ))}

      {recent.length > 0 && (
        <Card title="Revisadas recientemente">
          <ul className="divide-y divide-slate-100 text-sm">
            {recent.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>
                  {s.clientId ? <Link href={`/admin/clientes/${s.clientId}`} className="text-brand hover:underline">{s.businessName}</Link> : s.businessName}
                  {s.reviewNote && <span className="ml-2 text-xs text-slate-500">{s.reviewNote}</span>}
                </span>
                <Badge tone={s.status === "APPROVED" ? "green" : "red"}>{s.status === "APPROVED" ? "Aprobada" : "Rechazada"}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
