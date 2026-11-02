import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_LABEL, folio, prisma, TICKET_STATUS_STAFF } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, Select } from "@/components/ui";
import { TicketComposer } from "@/components/ticket-composer";
import { TicketThread } from "@/components/ticket-thread";
import { assignAction, statusAction, staffReplyAction } from "../actions";

export const metadata: Metadata = { title: "Reporte de soporte" };

const TONE = { OPEN: "blue", IN_PROGRESS: "amber", WAITING_CLIENT: "gray", RESOLVED: "green" } as const;

export default async function TicketAdminPage({ params }: PageProps<"/admin/soporte/[id]">) {
  await requireUser(STAFF_ROLES);
  const { id } = await params;
  const t = await prisma.ticket.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      client: { select: { id: true, name: true, publicId: true, contactName: true, phone: true } },
      order: { select: { id: true, code: true, status: true } },
    },
  });
  if (!t) notFound();
  await prisma.ticket.update({ where: { id: t.id }, data: { staffSeenAt: new Date() } });
  const authorIds = [...new Set(t.messages.map((m) => m.authorId).filter(Boolean) as string[])];
  const [authors, staff, others] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { role: { in: STAFF_ROLES }, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.ticket.findMany({ where: { clientId: t.clientId, id: { not: t.id } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, number: true, subject: true, status: true } }),
  ]);
  const names = new Map(authors.map((a) => [a.id, a.name]));
  const digits = (t.client.phone ?? "").replace(/\D/g, "").slice(-10);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow={`Soporte · ${folio(t.number)}`} title={t.subject} actions={<Link href="/admin/soporte" className="text-sm text-brand hover:underline">← Soporte</Link>}>
        <Badge tone={TONE[t.status]}>{TICKET_STATUS_STAFF[t.status]}</Badge>{" "}
        <span className="text-slate-500">· {CATEGORY_LABEL[t.category] ?? t.category} · abierto {fecha(t.createdAt)}</span>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <TicketThread messages={t.messages} viewer="staff" names={names} />
          </Card>
          <Card title="Responder">
            <TicketComposer action={staffReplyAction.bind(null, t.id)} submitLabel="Enviar" placeholder="Respuesta para la tienda (o nota interna)…">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  Después:
                  <select name="next" defaultValue="WAITING_CLIENT" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
                    <option value="WAITING_CLIENT">Esperar respuesta de la tienda</option>
                    <option value="IN_PROGRESS">Sigo trabajando en esto</option>
                    <option value="RESOLVED">Marcar como resuelto</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-amber-800">
                  <input type="checkbox" name="internal" className="accent-amber-600" /> 🔒 Nota interna (la tienda no la ve)
                </label>
              </div>
            </TicketComposer>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Tienda">
            <p className="text-sm">
              <Link href={`/admin/clientes/${t.client.id}`} className="font-medium text-brand hover:underline">{t.client.name}</Link>{" "}
              <span className="font-mono text-xs text-slate-500">{t.client.publicId}</span>
            </p>
            {t.client.contactName && <p className="text-sm text-slate-600">{t.client.contactName}</p>}
            {digits.length === 10 && (
              <a href={`https://wa.me/52${digits}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-emerald-700 hover:underline">WhatsApp {t.client.phone}</a>
            )}
            {t.order && (
              <p className="mt-2 text-sm">Envío: <Link href={`/admin/pedidos/${t.order.id}`} className="font-mono text-brand hover:underline">{t.order.code}</Link></p>
            )}
          </Card>
          <Card title="Estado">
            <div className="flex flex-wrap gap-2">
              {(["IN_PROGRESS", "WAITING_CLIENT", "RESOLVED"] as const).filter((s) => s !== t.status).map((s) => (
                <form key={s} action={statusAction.bind(null, t.id, s)}>
                  <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">{TICKET_STATUS_STAFF[s]}</button>
                </form>
              ))}
            </div>
          </Card>
          <Card title="Responsable">
            <ActionForm action={assignAction.bind(null, t.id)} submitLabel="Guardar">
              <Select label="Quién lo atiende" name="assignedToId" defaultValue={t.assignedToId ?? ""}>
                <option value="">Sin asignar</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </ActionForm>
          </Card>
          {others.length > 0 && (
            <Card title="Otros reportes de esta tienda">
              <ul className="space-y-1 text-sm">
                {others.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/soporte/${o.id}`} className="text-brand hover:underline">{folio(o.number)}</Link> {o.subject}{" "}
                    <span className="text-xs text-slate-500">({TICKET_STATUS_STAFF[o.status]})</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
