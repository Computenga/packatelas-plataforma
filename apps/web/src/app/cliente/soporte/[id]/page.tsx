import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_LABEL, folio, prisma, TICKET_STATUS_LABEL } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { Badge, Card } from "@/components/ui";
import { TicketComposer } from "@/components/ticket-composer";
import { TicketThread } from "@/components/ticket-thread";
import { replyAction, resolveAction } from "../actions";

export const metadata: Metadata = { title: "Reporte" };

const TONE = { OPEN: "blue", IN_PROGRESS: "amber", WAITING_CLIENT: "red", RESOLVED: "green" } as const;

export default async function TicketClientePage({ params }: PageProps<"/cliente/soporte/[id]">) {
  const { clientId } = await requireClient();
  const { id } = await params;
  const t = await prisma.ticket.findFirst({
    where: { id, clientId },
    include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" } }, order: { select: { id: true, code: true } } },
  });
  if (!t) notFound();
  await prisma.ticket.update({ where: { id: t.id }, data: { clientSeenAt: new Date() } });
  const authorIds = [...new Set(t.messages.filter((m) => !m.fromStaff && m.authorId).map((m) => m.authorId!))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/cliente/soporte" className="text-sm text-brand hover:underline">← Ayuda y soporte</Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{t.subject}</h1>
          <p className="text-xs text-slate-500">
            {folio(t.number)} · {CATEGORY_LABEL[t.category] ?? t.category}
            {t.order && (
              <>
                {" · "}
                <Link href={`/cliente/envio/${t.order.id}`} className="text-brand hover:underline">{t.order.code}</Link>
              </>
            )}
          </p>
        </div>
        <Badge tone={TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
      </div>
      <Card>
        <TicketThread messages={t.messages} viewer="client" names={names} />
      </Card>
      <Card title={t.status === "RESOLVED" ? "¿Sigue el problema? Escríbenos y lo reabrimos" : "Responder"}>
        <TicketComposer action={replyAction.bind(null, t.id)} submitLabel="Enviar" />
      </Card>
      {t.status !== "RESOLVED" && (
        <form action={resolveAction.bind(null, t.id)} className="text-right">
          <button className="text-sm text-slate-500 underline hover:text-slate-800">Ya quedó resuelto, cerrar reporte</button>
        </form>
      )}
    </div>
  );
}
