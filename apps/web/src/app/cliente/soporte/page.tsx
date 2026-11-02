import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABEL, folio, prisma, TICKET_CATEGORIES, TICKET_STATUS_LABEL } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import { TicketComposer } from "@/components/ticket-composer";
import { newTicketAction } from "./actions";

export const metadata: Metadata = { title: "Ayuda y soporte" };

const TONE = { OPEN: "blue", IN_PROGRESS: "amber", WAITING_CLIENT: "red", RESOLVED: "green" } as const;

export default async function SoporteClientePage({ searchParams }: PageProps<"/cliente/soporte">) {
  const { clientId } = await requireClient();
  const envio = String((await searchParams).envio ?? "");
  const tickets = await prisma.ticket.findMany({
    where: { clientId },
    orderBy: [{ lastMessageAt: "desc" }],
    take: 50,
    include: { order: { select: { code: true } } },
  });
  const open = tickets.filter((t) => t.status !== "RESOLVED");
  const closed = tickets.filter((t) => t.status === "RESOLVED");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Ayuda y soporte</h1>
      <p className="text-sm text-slate-600">
        Repórtanos cualquier problema o duda: un envío, un paquete dañado, tu saldo, facturas o el portal. Te respondemos aquí mismo y te llega un aviso.
      </p>

      {open.length > 0 && (
        <Card title="Tus reportes abiertos">
          <TicketList tickets={open} />
        </Card>
      )}

      <Card title="Nuevo reporte">
        <TicketComposer action={newTicketAction} submitLabel="Enviar reporte" placeholder="Cuéntanos qué pasó. Si es un envío, incluye lo que sepas (fecha, destinatario)…">
          <label className="block text-sm">
            <span className="text-slate-600">¿De qué se trata?</span>
            <select name="category" required defaultValue={envio ? "envio" : ""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="" disabled>Elige una opción</option>
              {TICKET_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Título</span>
            <input name="subject" required maxLength={120} placeholder="Ej. Mi paquete no ha llegado" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Número de envío (opcional)</span>
            <input name="orderRef" defaultValue={envio} maxLength={40} placeholder="ML-4632… o PK-000123" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
          </label>
        </TicketComposer>
      </Card>

      {closed.length > 0 && (
        <Card title="Resueltos">
          <TicketList tickets={closed} />
        </Card>
      )}
    </div>
  );

  function TicketList({ tickets }: { tickets: typeof open }) {
    return (
      <ul className="divide-y divide-slate-100">
        {tickets.map((t) => {
          const unread = t.status === "WAITING_CLIENT" || (t.clientSeenAt && t.lastMessageAt > t.clientSeenAt);
          return (
            <li key={t.id}>
              <Link href={`/cliente/soporte/${t.id}`} className="flex items-start justify-between gap-3 py-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className={`block truncate ${unread ? "font-semibold" : "font-medium"}`}>{t.subject}</span>
                  <span className="block text-xs text-slate-500">
                    {folio(t.number)} · {CATEGORY_LABEL[t.category] ?? t.category}
                    {t.order ? ` · ${t.order.code}` : ""} · {fecha(t.lastMessageAt)}
                  </span>
                </span>
                <Badge tone={TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
}
