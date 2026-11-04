import type { Metadata } from "next";
import Link from "next/link";
import { portalInviteTargets, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { templateStatuses } from "@/lib/wa-templates";
import { sendInvitesAction, toggleOmitAction } from "./actions";

export const metadata: Metadata = { title: "Invitar al portal" };
export const dynamic = "force-dynamic";

/** Campaña por WhatsApp a tiendas sin acceso activado o sin Mercado Libre autorizado. */
export default async function InvitarPage() {
  await requireUser(["ADMIN"]);
  const [{ groups, noPhone }, st] = await Promise.all([portalInviteTargets(prisma), templateStatuses()]);
  const tpl = (name: string) => st?.find((s) => s.template === name)?.status ?? "—";
  const ready = tpl("pk_invitacion_portal") === "APPROVED" && tpl("pk_conectar_ml") === "APPROVED";
  const live = groups.filter((g) => !g.omitted);
  const tone = (s: string) => (s === "APPROVED" ? "green" : s === "REJECTED" ? "red" : "amber");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/admin/avisos" className="text-sm text-brand hover:underline">← Avisos</Link>
      <PageHeader eyebrow="Avisos" title="Invitar al portal">
        WhatsApp desde el número de Meta a las tiendas que no han activado su acceso o no han autorizado Mercado Libre. Un mensaje por número, una vez al día como máximo.
      </PageHeader>

      <Card title="Plantillas en Meta">
        <p className="text-sm">
          pk_invitacion_portal <Badge tone={tone(tpl("pk_invitacion_portal"))}>{tpl("pk_invitacion_portal")}</Badge> · pk_conectar_ml <Badge tone={tone(tpl("pk_conectar_ml"))}>{tpl("pk_conectar_ml")}</Badge>
        </p>
        {!ready && <p className="mt-2 text-sm text-slate-600">Si dicen «No registrada», regístralas en <Link href="/admin/avisos" className="text-brand underline">Avisos → Plantillas</Link>. El envío se habilita cuando Meta las aprueba.</p>}
      </Card>

      <Card title={`Se enviará a ${live.length} números`} actions={ready ? <ActionForm action={sendInvitesAction} submitLabel={`Enviar ${live.length} WhatsApp`}><span /></ActionForm> : undefined}>
        <ul className="divide-y divide-slate-100">
          {groups.map((g) => (
            <li key={g.phone} className={`py-3 text-sm ${g.omitted ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">…{g.phone.slice(-4)}</span>
                <Badge tone={g.event === "acceso_portal" ? "blue" : "amber"}>{g.event === "acceso_portal" ? "Activar + ML" : "Solo ML"}</Badge>
                {g.omitted && <Badge>Excluido</Badge>}
                {g.lastSentAt && <span className="text-xs text-slate-500">Último envío {fecha(g.lastSentAt)}</span>}
              </div>
              <ul className="mt-1 space-y-1">
                {g.clients.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/clientes/${c.id}`} className="font-medium hover:underline">{c.publicId.toUpperCase()} · {c.name}</Link>
                    <span className="text-xs text-slate-500">{c.activated ? "acceso activo" : "sin activar"} · {c.mlConnected ? "ML conectado" : c.mlAccounts ? "ML sin autorizar" : "sin cuenta ML"}</span>
                    <form action={toggleOmitAction.bind(null, c.id, !c.omitted)}>
                      <button className="text-xs text-brand hover:underline">{c.omitted ? "Incluir" : "Excluir"}</button>
                    </form>
                  </li>
                ))}
              </ul>
              {!g.omitted && <p className="mt-1 text-xs text-slate-500">«{g.preview}»</p>}
            </li>
          ))}
        </ul>
      </Card>

      {noPhone.length > 0 && (
        <Card title={`Sin teléfono capturado (${noPhone.length})`}>
          <ul className="text-sm">{noPhone.map((c) => <li key={c.id}><Link href={`/admin/clientes/${c.id}`} className="hover:underline">{c.publicId.toUpperCase()} · {c.name}</Link></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
