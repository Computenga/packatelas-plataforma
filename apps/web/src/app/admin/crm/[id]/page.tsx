import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clientMatchesForLead, prisma, LEAD_STAGES, SOURCE_LABEL, STAGE_LABEL } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, hace } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, Select, TextArea } from "@/components/ui";
import { activityAction, assignAction, linkClientAction, stageAction, updateLeadAction } from "../actions";
import { LeadFields } from "../lead-fields";

export const metadata: Metadata = { title: "Prospecto" };

const ACT_LABEL: Record<string, string> = { nota: "Nota", llamada: "Llamada", whatsapp: "WhatsApp", visita: "Visita", etapa: "Etapa", sistema: "Sistema" };
const requestTime = () => Date.now();

export default async function LeadPage({ params, searchParams }: PageProps<"/admin/crm/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const sp = await searchParams;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { owner: { select: { id: true, name: true } }, activities: { orderBy: { createdAt: "desc" }, take: 100 } },
  });
  if (!lead) notFound();
  const now = requestTime();
  const [owners, client, signup, matches] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "OPERADOR", "DESPACHADOR"] }, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    lead.clientId ? prisma.client.findUnique({ where: { id: lead.clientId }, select: { id: true, name: true, publicId: true, _count: { select: { orders: true } } } }) : null,
    lead.signupId ? prisma.clientSignup.findUnique({ where: { id: lead.signupId }, select: { status: true } }) : null,
    clientMatchesForLead(prisma, lead.id),
  ]);
  const authors = new Map(owners.map((o) => [o.id, o.name]));
  const digits = (lead.phone ?? "").replace(/\D/g, "").slice(-10);
  const first = lead.contactName?.split(/\s+/)[0] ?? "";
  const waText = lead.clientId
    ? `Hola ${first}, te escribo de Packatelas. ¿Cómo te ha ido con tus envíos? ¿Ya conectaste tu cuenta de Mercado Libre en portal.packatelas.mx?`
    : `Hola ${first}, te escribo de Packatelas. Vi que te interesa nuestro servicio de envíos para ${lead.businessName}. ¿Te comparto cómo funciona y las tarifas?`;
  const currentRank = LEAD_STAGES.findIndex((s) => s.key === lead.stage);
  const overdue = lead.nextActionAt && lead.nextActionAt.getTime() < now;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="CRM" title={lead.businessName} actions={<Link href="/admin/crm" className="text-sm text-brand hover:underline">← Volver al CRM</Link>}>
        <Badge tone={lead.stage === "PERDIDO" ? "red" : lead.stage === "ACTIVO" ? "green" : "blue"}>{STAGE_LABEL[lead.stage]}</Badge>{" "}
        <span className="text-slate-500">· {SOURCE_LABEL[lead.source]} · desde {fecha(lead.createdAt)}</span>
      </PageHeader>
      {sp.ya === "1" && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Ya existía un prospecto con ese teléfono o correo: abrimos ese y anotamos el nuevo registro en su historial.</p>}

      {/* Avance */}
      <ol className="mb-4 flex gap-1 overflow-x-auto text-xs">
        {LEAD_STAGES.filter((s) => s.key !== "PERDIDO").map((s, i) => {
          const done = lead.stage !== "PERDIDO" && i <= currentRank;
          return (
            <li key={s.key} className={`shrink-0 rounded-full px-2.5 py-1 ${done ? "bg-brand text-white" : "bg-slate-100 text-slate-500"}`}>
              {s.label}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title="Contactar">
            <div className="flex flex-wrap gap-2 text-sm">
              {digits.length === 10 && (
                <>
                  <a href={`https://wa.me/52${digits}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white">WhatsApp</a>
                  <a href={`tel:+52${digits}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2">Llamar {lead.phone}</a>
                </>
              )}
              {lead.email && <a href={`mailto:${lead.email}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2">{lead.email}</a>}
              {!digits && !lead.email && <span className="text-slate-500">Sin teléfono ni correo: agrégalos abajo.</span>}
            </div>
            {lead.nextActionAt && (
              <p className={`mt-3 text-sm ${overdue ? "font-medium text-amber-700" : "text-slate-600"}`}>
                Qué sigue: {lead.nextAction ?? "Seguimiento"} · {overdue ? `vencido hace ${hace(lead.nextActionAt, now)}` : fecha(lead.nextActionAt)}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">Último contacto: {lead.lastContactAt ? `hace ${hace(lead.lastContactAt, now)}` : "ninguno registrado"}</p>
          </Card>

          <Card title="Registrar contacto o nota">
            <ActionForm action={activityAction.bind(null, lead.id)} submitLabel="Registrar" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <Select label="Tipo" name="type" defaultValue="whatsapp">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="llamada">Llamada</option>
                  <option value="visita">Visita</option>
                  <option value="nota">Nota</option>
                </Select>
                <TextArea label="Qué pasó" name="text" rows={2} required placeholder="Le mandé tarifas; quiere empezar el lunes…" />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <Field label="Siguiente paso (opcional)" name="nextAction" placeholder="Llamar para cerrar" />
                <Field label="Para cuándo" name="nextActionAt" type="date" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="clearNext" className="accent-brand" /> Ya no hay siguiente paso
              </label>
            </ActionForm>
          </Card>

          <Card title="Historial">
            <ol className="space-y-3 text-sm">
              {lead.activities.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="w-20 shrink-0 text-xs text-slate-500">{ACT_LABEL[a.type] ?? a.type}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-pre-wrap">{a.text}</span>
                    <span className="block text-xs text-slate-400">
                      {fecha(a.createdAt)}
                      {a.userId && authors.get(a.userId) ? ` · ${authors.get(a.userId)}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Etapa">
            {LEAD_STAGES.find((s) => s.key === lead.stage)?.auto ? (
              <p className="mb-3 text-sm text-slate-600">Ya es cliente: avanza solo cuando conecta Mercado Libre, manda su primer envío y llega a 10 envíos.</p>
            ) : null}
            <ActionForm action={stageAction.bind(null, lead.id)} submitLabel="Cambiar etapa">
              <Select label="Mover a" name="stage" defaultValue={["NUEVO", "CONTACTADO", "INTERESADO", "PERDIDO"].includes(lead.stage) ? lead.stage : "PERDIDO"}>
                <option value="NUEVO">Nuevo</option>
                <option value="CONTACTADO">Contactado</option>
                <option value="INTERESADO">Interesado</option>
                <option value="PERDIDO">Perdido</option>
              </Select>
              <Field label="Si se perdió, ¿por qué?" name="lostReason" placeholder="Precio, fuera de zona, no contestó…" defaultValue={lead.lostReason ?? ""} />
            </ActionForm>
          </Card>

          <Card title="Cliente">
            {client ? (
              <p className="text-sm">
                <Link href={`/admin/clientes/${client.id}`} className="font-medium text-brand hover:underline">{client.publicId} · {client.name}</Link>
                <span className="block text-xs text-slate-500">{client._count.orders} envío(s) registrados</span>
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                {signup?.status === "PENDING" && (
                  <p>
                    Su registro está esperando aprobación: <Link href="/admin/clientes/solicitudes" className="font-medium text-brand hover:underline">aprobar en Solicitudes</Link> (crea el cliente y lo liga aquí).
                  </p>
                )}
                {!signup && (
                  <p className="text-slate-600">
                    Cuando acepte, mándale <span className="font-mono">portal.packatelas.mx/registro</span> para que se registre (se liga solo por teléfono o correo), o
                    créalo en <Link href="/admin/clientes/nuevo" className="text-brand hover:underline">Clientes → Nuevo</Link> y lígalo abajo.
                  </p>
                )}
                {matches.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Parece que ya es cliente:</p>
                    {matches.map((m) => (
                      <ActionForm key={m.id} action={linkClientAction.bind(null, lead.id)} submitLabel={`Ligar a ${m.publicId}`}>
                        <input type="hidden" name="client" value={m.id} />
                        <span className="block">{m.name}</span>
                      </ActionForm>
                    ))}
                  </div>
                )}
                <ActionForm action={linkClientAction.bind(null, lead.id)} submitLabel="Ligar cliente">
                  <Field label="ID del cliente" name="client" placeholder="cmx00123" />
                </ActionForm>
              </div>
            )}
          </Card>

          <Card title="Responsable">
            <ActionForm action={assignAction.bind(null, lead.id)} submitLabel="Guardar">
              <Select label="Quién le da seguimiento" name="ownerId" defaultValue={lead.ownerId ?? ""}>
                <option value="">Sin asignar</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </ActionForm>
          </Card>

          <Card title="Datos">
            <ActionForm action={updateLeadAction.bind(null, lead.id)} submitLabel="Guardar datos">
              <LeadFields lead={lead} owners={owners} />
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
