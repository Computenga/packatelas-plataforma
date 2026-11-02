import type { Metadata } from "next";
import Link from "next/link";
import { coolingClients, prisma, LEAD_STAGES, SOURCE_LABEL, STAGE_LABEL, type LeadStage, type Prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, hace, startOfTodayMx } from "@/lib/format";
import { Badge, ButtonLink, PageHeader, Table, Td } from "@/components/ui";

export const metadata: Metadata = { title: "CRM" };

const VIEWS = [
  { key: "", label: "Embudo" },
  { key: "hoy", label: "Para hoy" },
  { key: "enfriando", label: "Clientes que se enfrían" },
  { key: "perdidos", label: "Perdidos" },
] as const;
const BOARD: LeadStage[] = ["NUEVO", "CONTACTADO", "INTERESADO", "ALTA", "ML_CONECTADO", "PRIMER_ENVIO", "ACTIVO"];
const requestTime = () => Date.now();
const waLink = (phone: string | null, text: string) => {
  const d = (phone ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `https://wa.me/52${d}?text=${encodeURIComponent(text)}` : null;
};
const initials = (name?: string | null) => (name ?? "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export default async function CrmPage({ searchParams }: PageProps<"/admin/crm">) {
  const me = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const view = typeof sp.vista === "string" ? sp.vista : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const mine = sp.mios === "1";
  const now = requestTime();
  const endToday = new Date(startOfTodayMx().getTime() + 86400_000);
  const monthStart = new Date(startOfTodayMx().getTime() - 30 * 86400_000);

  const where: Prisma.LeadWhereInput = {
    ...(q ? { OR: [{ businessName: { contains: q, mode: "insensitive" } }, { contactName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    ...(mine ? { ownerId: me.id } : {}),
  };

  const [counts, newMonth, altaMonth, activeMonth, dueCount] = await Promise.all([
    prisma.lead.groupBy({ by: ["stage"], where, _count: { _all: true } }),
    prisma.lead.count({ where: { ...where, createdAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { ...where, clientId: { not: null }, stageAt: { gte: monthStart }, stage: { notIn: ["NUEVO", "CONTACTADO", "INTERESADO", "PERDIDO"] } } }),
    prisma.lead.count({ where: { ...where, stage: "ACTIVO", stageAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { ...where, stage: { notIn: ["PERDIDO", "ACTIVO"] }, nextActionAt: { lt: endToday } } }),
  ]);
  const count = (s: LeadStage) => counts.find((c) => c.stage === s)?._count._all ?? 0;

  const tabHref = (v: string) => {
    const p = new URLSearchParams();
    if (v) p.set("vista", v);
    if (q) p.set("q", q);
    if (mine) p.set("mios", "1");
    const s = p.toString();
    return `/admin/crm${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Clientes" title="CRM" actions={<><ButtonLink href="/admin/crm/importar" variant="secondary">Importar</ButtonLink><ButtonLink href="/admin/crm/nuevo">Nuevo prospecto</ButtonLink></>}>
        Prospectos desde que se interesan hasta que envían con regularidad. De «Dado de alta» en adelante avanza solo.
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Nuevos (30 días)" value={newMonth} />
        <Stat label="Se dieron de alta (30 días)" value={altaMonth} />
        <Stat label="Ya activos (30 días)" value={activeMonth} />
        <Link href={tabHref("hoy")} className={`rounded-xl border bg-white p-3 ${dueCount ? "border-amber-300" : "border-slate-200"}`}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Seguimientos para hoy</p>
          <p className={`text-2xl font-bold tabular-nums ${dueCount ? "text-amber-700" : ""}`}>{dueCount}</p>
        </Link>
      </div>

      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm" aria-label="Vistas">
        {VIEWS.map((v) => (
          <Link key={v.key} href={tabHref(v.key)} aria-current={view === v.key ? "page" : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 ${view === v.key ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {v.label}
            {v.key === "perdidos" && count("PERDIDO") > 0 && <span className="ml-1 text-xs text-slate-400">{count("PERDIDO")}</span>}
          </Link>
        ))}
      </nav>

      {view !== "enfriando" && (
        <form className="mb-4 flex flex-wrap gap-2 text-sm">
          {view && <input type="hidden" name="vista" value={view} />}
          <input name="q" defaultValue={q} placeholder="Negocio, contacto, teléfono o correo" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2" />
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3">
            <input type="checkbox" name="mios" value="1" defaultChecked={mine} className="accent-brand" /> Solo míos
          </label>
          <button className="rounded-lg bg-brand px-4 py-2 text-white">Buscar</button>
        </form>
      )}

      {view === "" && <Board where={where} now={now} endToday={endToday} />}
      {view === "hoy" && <Today where={where} now={now} endToday={endToday} />}
      {view === "perdidos" && <Lost where={where} />}
      {view === "enfriando" && <Cooling />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

const cardSelect = {
  id: true, businessName: true, contactName: true, phone: true, source: true, stage: true, stageAt: true, monthlyVolume: true,
  nextAction: true, nextActionAt: true, owner: { select: { name: true } },
} satisfies Prisma.LeadSelect;

async function Board({ where, now, endToday }: { where: Prisma.LeadWhereInput; now: number; endToday: Date }) {
  const leads = await prisma.lead.findMany({
    where: { ...where, stage: { in: BOARD } },
    select: cardSelect,
    orderBy: [{ nextActionAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 600,
  });
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
      {BOARD.map((stage) => {
        const col = leads.filter((l) => l.stage === stage);
        const auto = LEAD_STAGES.find((s) => s.key === stage)?.auto;
        return (
          <section key={stage} className="w-72 shrink-0 snap-start rounded-xl bg-slate-100/70 p-2">
            <h2 className="mb-2 flex items-baseline justify-between px-1 text-sm font-semibold">
              <span>
                {STAGE_LABEL[stage]}
                {auto && <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-slate-400">auto</span>}
              </span>
              <span className="text-xs text-slate-500">{col.length}</span>
            </h2>
            <ul className="space-y-2">
              {col.slice(0, 80).map((l) => (
                <li key={l.id}>
                  <LeadCard l={l} now={now} endToday={endToday} />
                </li>
              ))}
              {col.length > 80 && <li className="px-1 text-xs text-slate-500">y {col.length - 80} más (usa el buscador)</li>}
              {col.length === 0 && <li className="px-1 py-3 text-xs text-slate-400">Sin prospectos</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LeadCard({ l, now, endToday }: { l: Prisma.LeadGetPayload<{ select: typeof cardSelect }>; now: number; endToday: Date }) {
  const overdue = l.nextActionAt && l.nextActionAt < endToday;
  return (
    <Link href={`/admin/crm/${l.id}`} className="block rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-sm hover:border-brand/40">
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-medium">{l.businessName}</span>
        {l.owner && <span title={l.owner.name} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">{initials(l.owner.name)}</span>}
      </span>
      <span className="block truncate text-xs text-slate-500">
        {[l.contactName, l.monthlyVolume && `${l.monthlyVolume} envíos/mes`].filter(Boolean).join(" · ") || SOURCE_LABEL[l.source]}
      </span>
      {l.nextActionAt && (
        <span className={`mt-1.5 block text-xs ${overdue ? "font-medium text-amber-700" : "text-slate-500"}`}>
          {overdue ? "⏰ " : ""}
          {l.nextAction ?? "Seguimiento"} · {l.nextActionAt.getTime() < now ? `hace ${hace(l.nextActionAt, now)}` : fecha(l.nextActionAt)}
        </span>
      )}
      <span className="mt-1 block text-[11px] text-slate-400">En esta etapa hace {hace(l.stageAt, now)}</span>
    </Link>
  );
}

async function Today({ where, now, endToday }: { where: Prisma.LeadWhereInput; now: number; endToday: Date }) {
  const leads = await prisma.lead.findMany({
    where: { ...where, stage: { notIn: ["PERDIDO", "ACTIVO"] }, nextActionAt: { lt: endToday } },
    select: cardSelect,
    orderBy: { nextActionAt: "asc" },
    take: 200,
  });
  return (
    <Table head={["Prospecto", "Qué sigue", "Desde", "Etapa", "Responsable", ""]} empty={leads.length ? undefined : "Nada pendiente para hoy 🎉"}>
      {leads.map((l) => {
        const wa = waLink(l.phone, `Hola ${l.contactName?.split(/\s+/)[0] ?? ""}, te escribo de Packatelas sobre ${l.businessName}.`);
        return (
          <tr key={l.id} className="hover:bg-slate-50">
            <Td>
              <Link href={`/admin/crm/${l.id}`} className="font-medium text-brand hover:underline">{l.businessName}</Link>
              <span className="block text-xs text-slate-500">{l.contactName ?? "—"}</span>
            </Td>
            <Td>{l.nextAction ?? "Seguimiento"}</Td>
            <Td className="text-xs text-slate-600">{l.nextActionAt && l.nextActionAt.getTime() < now ? `hace ${hace(l.nextActionAt, now)}` : "hoy"}</Td>
            <Td><Badge tone="blue">{STAGE_LABEL[l.stage]}</Badge></Td>
            <Td>{l.owner?.name ?? <span className="text-slate-400">Sin asignar</span>}</Td>
            <Td>{wa && <a href={wa} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">WhatsApp</a>}</Td>
          </tr>
        );
      })}
    </Table>
  );
}

async function Lost({ where }: { where: Prisma.LeadWhereInput }) {
  const [leads, reasons] = await Promise.all([
    prisma.lead.findMany({ where: { ...where, stage: "PERDIDO" }, select: { id: true, businessName: true, contactName: true, lostReason: true, stageAt: true, source: true }, orderBy: { stageAt: "desc" }, take: 200 }),
    prisma.lead.groupBy({ by: ["lostReason"], where: { ...where, stage: "PERDIDO" }, _count: { _all: true }, orderBy: { _count: { lostReason: "desc" } }, take: 8 }),
  ]);
  return (
    <div className="space-y-4">
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {reasons.map((r) => (
            <span key={r.lostReason ?? "-"} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              {r.lostReason ?? "Sin motivo"} <span className="font-semibold">{r._count._all}</span>
            </span>
          ))}
        </div>
      )}
      <Table head={["Prospecto", "Motivo", "Origen", "Cuándo"]} empty={leads.length ? undefined : "Sin prospectos perdidos"}>
        {leads.map((l) => (
          <tr key={l.id} className="hover:bg-slate-50">
            <Td>
              <Link href={`/admin/crm/${l.id}`} className="font-medium text-brand hover:underline">{l.businessName}</Link>
              <span className="block text-xs text-slate-500">{l.contactName ?? "—"}</span>
            </Td>
            <Td className="max-w-xs truncate">{l.lostReason ?? "—"}</Td>
            <Td>{SOURCE_LABEL[l.source]}</Td>
            <Td className="text-xs text-slate-600">{fecha(l.stageAt)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

async function Cooling() {
  const rows = await coolingClients(prisma);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Clientes con 10 o más envíos en los dos meses anteriores que llevan más de 10 días sin mandar nada. Vale la pena una llamada antes de que se vayan.
      </p>
      <Table head={["Cliente", "Envíos (60 días antes)", "Último envío", ""]} empty={rows.length ? undefined : "Ningún cliente frecuente se ha detenido"}>
        {rows.map((c) => {
          const wa = waLink(c.phone, `Hola ${c.contactName?.split(/\s+/)[0] ?? ""}, te escribo de Packatelas. Notamos que no hemos recogido envíos de ${c.name} últimamente, ¿todo bien? ¿Te podemos ayudar en algo?`);
          return (
            <tr key={c.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/admin/clientes/${c.id}`} className="font-medium text-brand hover:underline">{c.name}</Link>
                <span className="block font-mono text-xs text-slate-500">{c.publicId}</span>
              </Td>
              <Td className="tabular-nums">{c.orders}</Td>
              <Td className="text-xs text-slate-600">{fecha(c.lastOrderAt)}</Td>
              <Td>{wa ? <a href={wa} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">WhatsApp</a> : <span className="text-xs text-slate-400">Sin teléfono</span>}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
