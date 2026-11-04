import Link from "next/link";
import { fmtDue, listTasks, prisma, TASK_PRIORITY, TASK_STATUS, taskCounters, taskFolio, type TaskScope } from "@packatelas/db";
import { Badge, ButtonLink, PageHeader } from "@/components/ui";

type Search = { ver?: string; estado?: string; q?: string };
const SCOPES: [TaskScope, string][] = [["all", "Todas"], ["mine", "Para mí"], ["assigned", "Asigné"]];

/** Lista de tareas (la misma pantalla en el portal de cada rol). */
export async function TaskList({ userId, base, search }: { userId: string; base: string; search: Search }) {
  const scope = (SCOPES.find(([k]) => k === search.ver)?.[0] ?? "all") as TaskScope;
  const closed = search.estado === "cerradas";
  const now = new Date();
  const [tasks, c] = await Promise.all([listTasks(prisma, userId, { scope, open: !closed, q: search.q }), taskCounters(prisma, userId, now)]);
  const href = (p: Partial<Search>) => {
    const q = new URLSearchParams({ ...(scope !== "all" ? { ver: scope } : {}), ...(closed ? { estado: "cerradas" } : {}), ...(search.q ? { q: search.q } : {}), ...p } as Record<string, string>);
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    return `${base}${q.size ? `?${q}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Tareas" actions={<ButtonLink href={`${base}/nueva`}>+ Nueva tarea</ButtonLink>}>
        {c.mine} abiertas a tu nombre{c.overdue ? <> · <span className="font-semibold text-red-600">{c.overdue} vencidas</span></> : null}
        {c.toReview ? <> · <span className="font-semibold text-amber-700">{c.toReview} por revisar</span></> : null}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {SCOPES.map(([k, l]) => (
            <Link key={k} href={href({ ver: k === "all" ? "" : k })} className={`rounded-md px-3 py-1.5 ${scope === k ? "bg-brand font-semibold text-white" : "text-slate-600"}`}>{l}</Link>
          ))}
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          <Link href={href({ estado: "" })} className={`rounded-md px-3 py-1.5 ${!closed ? "bg-slate-800 font-semibold text-white" : "text-slate-600"}`}>Abiertas</Link>
          <Link href={href({ estado: "cerradas" })} className={`rounded-md px-3 py-1.5 ${closed ? "bg-slate-800 font-semibold text-white" : "text-slate-600"}`}>Cerradas</Link>
        </div>
        <form action={base} className="min-w-0 flex-1">
          {scope !== "all" && <input type="hidden" name="ver" value={scope} />}
          {closed && <input type="hidden" name="estado" value="cerradas" />}
          <input name="q" defaultValue={search.q} placeholder="Buscar tarea o folio…" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </form>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          {closed ? "No hay tareas cerradas." : "No tienes tareas abiertas aquí."} <Link href={`${base}/nueva`} className="text-brand hover:underline">Asigna una</Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => {
            const steps = (t.checklist as { done: boolean }[] | null) ?? [];
            const late = t.dueAt && t.dueAt < now && ["PENDIENTE", "EN_PROCESO"].includes(t.status);
            const mine = t.assigneeId === userId;
            const reviewMe = t.status === "EN_REVISION" && t.createdById === userId && !mine;
            return (
              <li key={t.id}>
                <Link href={`${base}/${t.id}`} className={`block rounded-xl border bg-white p-4 hover:border-brand/40 ${reviewMe ? "border-amber-300" : late ? "border-red-200" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{taskFolio(t.number)}</span>
                    <Badge tone={TASK_STATUS[t.status][1]}>{TASK_STATUS[t.status][0]}</Badge>
                    {t.priority !== "NORMAL" && <Badge tone={TASK_PRIORITY[t.priority][1]}>{TASK_PRIORITY[t.priority][0]}</Badge>}
                    {reviewMe && <Badge tone="amber">Te toca revisar</Badge>}
                  </div>
                  <p className="mt-1 font-semibold">{t.title}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{mine ? (t.createdById === userId ? "Pendiente personal" : `De ${t.createdBy.name}`) : `Para ${t.assignee.name}`}</span>
                    {t.dueAt && <span className={late ? "font-semibold text-red-600" : ""}>{late ? "Venció " : "Para el "}{fmtDue(t.dueAt)}</span>}
                    {steps.length > 0 && <span>☑ {steps.filter((s) => s.done).length}/{steps.length}</span>}
                    {t._count.files > 0 && <span>📎 {t._count.files}</span>}
                    {t._count.events > 0 && <span>💬 {t._count.events}</span>}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
