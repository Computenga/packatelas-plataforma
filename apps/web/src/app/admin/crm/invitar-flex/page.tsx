import type { Metadata } from "next";
import Link from "next/link";
import { flexInviteStats, flexInviteTargets, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { templateStatuses } from "@/lib/wa-templates";
import { sendFlexInvitesAction } from "./actions";

export const metadata: Metadata = { title: "Invitar a Flex" };
export const dynamic = "force-dynamic";

/** Campaña por WhatsApp a los vendedores del listado de MercadoLibre. */
export default async function InvitarFlexPage({ searchParams }: PageProps<"/admin/crm/invitar-flex">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const zone = sp.zona === "cmx" || sp.zona === "emx" ? sp.zona : null;
  const limit = Math.min(500, Math.max(1, Number(sp.lote) || 150));
  const [{ total, optedOut, targets }, stats, st] = await Promise.all([flexInviteTargets(prisma, { zone, limit }), flexInviteStats(prisma), templateStatuses()]);
  const meta = st?.find((s) => s.template === "pk_invitacion_flex");
  const tpl = meta?.status ?? "—";
  const ready = tpl === "APPROVED" && !meta?.outdated;
  const tab = (z: string | null, label: string) => (
    <Link href={`/admin/crm/invitar-flex?${new URLSearchParams({ ...(z ? { zona: z } : {}), lote: String(limit) })}`} className={`rounded-lg px-3 py-1.5 text-sm ${zone === z ? "bg-brand text-white" : "bg-white text-slate-700"}`}>{label}</Link>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/admin/crm" className="text-sm text-brand hover:underline">← CRM</Link>
      <PageHeader eyebrow="CRM" title="Invitar a Flex">
        WhatsApp a los vendedores del listado de MercadoLibre que aún no son clientes. Un solo mensaje por vendedor. El botón «Escribir a Packatelas» abre el chat del WhatsApp oficial (56 6427 5415) con su cuenta de ML ya escrita. Si alguien contesta al número de avisos, se le responde solo con el enlace al oficial; quien toca «No me interesa» o responde BAJA no vuelve a recibir nada.
      </PageHeader>

      <Card title="Plantilla en Meta">
        <p className="text-sm">pk_invitacion_flex (Marketing) <Badge tone={ready ? "green" : tpl === "REJECTED" ? "red" : "amber"}>{tpl}</Badge></p>
        {meta?.outdated && <p className="mt-2 text-sm font-semibold text-red-700">La versión aprobada en Meta es la anterior (sin el botón al WhatsApp oficial). Actualízala en <Link href="/admin/avisos" className="underline">Avisos → Plantillas</Link> antes de enviar.</p>}
        {!ready && !meta?.outdated && <p className="mt-2 text-sm text-slate-600">Si dice «No registrada», regístrala en <Link href="/admin/avisos" className="text-brand underline">Avisos → Plantillas</Link>. El envío se habilita cuando Meta la aprueba.</p>}
      </Card>

      <Card title="Resultados">
        <p className="text-sm">
          Enviadas {stats.sent} · entregadas {(stats.status.DELIVERED ?? 0) + (stats.status.READ ?? 0)} · leídas {stats.status.READ ?? 0} · fallidas {stats.status.FAILED ?? 0} · respondieron {stats.replied} · interesados {stats.interested} · no les interesa {stats.lost}
        </p>
        <Link href="/admin/crm?origen=LISTA_ML" className="mt-1 inline-block text-sm text-brand hover:underline">Ver prospectos del listado en el CRM →</Link>
      </Card>

      <Card
        title={`Por invitar: ${total}${optedOut ? ` (${optedOut} dados de baja)` : ""}`}
        actions={ready && targets.length ? (
          <ActionForm action={sendFlexInvitesAction} submitLabel={`Enviar ${targets.length} WhatsApp`}>
            <input type="hidden" name="zone" value={zone ?? ""} />
            <input type="hidden" name="limit" value={limit} />
          </ActionForm>
        ) : undefined}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {tab(null, "Todas las zonas")}{tab("cmx", "CDMX")}{tab("emx", "Edomex")}
          <form className="ml-auto flex items-center gap-2 text-sm">
            {zone && <input type="hidden" name="zona" value={zone} />}
            Lote de
            <input name="lote" type="number" min={1} max={500} defaultValue={limit} className="w-20 rounded-lg border border-slate-300 px-2 py-1" />
            <button className="text-brand hover:underline">Aplicar</button>
          </form>
        </div>
        <p className="mb-2 text-xs text-slate-500">Recomendado: lotes de 100 a 200 al día para cuidar la calificación del número en Meta. Se manda en este orden:</p>
        {targets[0] && <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs">«{targets[0].preview}» <span className="text-slate-500">[Escribir a Packatelas → WhatsApp oficial 56 6427 5415] [No me interesa]</span></p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {targets.map((t) => (
            <li key={t.leadId} className="flex flex-wrap items-center gap-2 py-1.5">
              <Link href={`/admin/crm/${t.leadId}`} className="font-medium hover:underline">{t.name}</Link>
              <span className="font-mono text-xs text-slate-500">…{t.phone.slice(-4)}</span>
              <span className="text-xs text-slate-500">{[t.municipality, t.zone === "cmx" ? "CDMX" : t.zone === "emx" ? "Edomex" : null].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
