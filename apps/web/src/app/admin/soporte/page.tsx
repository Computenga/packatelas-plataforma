import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABEL, folio, prisma, TICKET_STATUS_STAFF, type Prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { fecha } from "@/lib/format";
import { Badge, PageHeader, Table, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Soporte" };

const TONE = { OPEN: "blue", IN_PROGRESS: "amber", WAITING_CLIENT: "gray", RESOLVED: "green" } as const;
const TABS = [
  { key: "abiertos", label: "Por atender", where: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
  { key: "mios", label: "Míos", where: {} },
  { key: "esperando", label: "Esperando a la tienda", where: { status: "WAITING_CLIENT" } },
  { key: "resueltos", label: "Resueltos", where: { status: "RESOLVED" } },
  { key: "todos", label: "Todos", where: {} },
] as const;

export default async function SoporteAdminPage({ searchParams }: PageProps<"/admin/soporte">) {
  const user = await requireUser(STAFF_ROLES);
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.f) ?? TABS[0];
  const q = String(sp.q ?? "").trim();
  const where: Prisma.TicketWhereInput = {
    ...(tab.where as Prisma.TicketWhereInput),
    ...(tab.key === "mios" ? { assignedToId: user.id, status: { not: "RESOLVED" } } : {}),
    ...(q
      ? { OR: [{ subject: { contains: q, mode: "insensitive" } }, { client: { name: { contains: q, mode: "insensitive" } } }, { client: { publicId: { equals: q, mode: "insensitive" } } }, ...(/^\D*\d+$/.test(q) ? [{ number: Number(q.replace(/\D/g, "")) }] : [])] }
      : {}),
  };
  const [tickets, counts, staff] = await Promise.all([
    prisma.ticket.findMany({ where, orderBy: [{ lastMessageAt: "desc" }], take: 100, include: { client: { select: { name: true, publicId: true } }, order: { select: { code: true } } } }),
    prisma.ticket.groupBy({ by: ["status"], _count: true }),
    prisma.user.findMany({ where: { role: { in: STAFF_ROLES } }, select: { id: true, name: true } }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const names = new Map(staff.map((s) => [s.id, s.name]));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader eyebrow="Tiendas" title="Soporte">
        Reportes y dudas que levantan las tiendas desde su portal. {n("OPEN")} nuevo(s), {n("IN_PROGRESS")} en atención.
      </PageHeader>
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/soporte?f=${t.key}`} className={`rounded-full px-3 py-1.5 text-sm ${t.key === tab.key ? "bg-brand text-white" : "bg-white ring-1 ring-slate-200"}`}>
            {t.label}
          </Link>
        ))}
        <form className="ml-auto">
          <input type="hidden" name="f" value={tab.key} />
          <input name="q" defaultValue={q} placeholder="Buscar tienda, folio o tema" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </form>
      </div>
      <Table head={["Folio", "Tienda", "Tema", "Estado", "Responsable", "Último mensaje"]} empty={tickets.length ? undefined : "No hay reportes aquí"}>
        {tickets.map((t) => {
          const unread = !t.staffSeenAt || t.lastMessageAt > t.staffSeenAt;
          return (
            <tr key={t.id} className="hover:bg-slate-50">
              <Td className="font-mono text-xs"><Link href={`/admin/soporte/${t.id}`} className="text-brand hover:underline">{folio(t.number)}</Link></Td>
              <Td><span className="font-medium">{t.client.name}</span> <span className="font-mono text-xs text-slate-500">{t.client.publicId}</span></Td>
              <Td>
                <Link href={`/admin/soporte/${t.id}`} className={`block max-w-xs truncate ${unread ? "font-semibold" : ""}`}>{unread && "● "}{t.subject}</Link>
                <span className="text-xs text-slate-500">{CATEGORY_LABEL[t.category] ?? t.category}{t.order ? ` · ${t.order.code}` : ""}</span>
              </Td>
              <Td><Badge tone={TONE[t.status]}>{TICKET_STATUS_STAFF[t.status]}</Badge></Td>
              <Td className="text-xs">{t.assignedToId ? names.get(t.assignedToId) ?? "—" : <span className="text-amber-700">Sin asignar</span>}</Td>
              <Td className="text-xs">{fecha(t.lastMessageAt)}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
