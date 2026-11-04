import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDue, getTaskFor, prisma, TASK_PRIORITY, TASK_STATUS, taskFolio } from "@packatelas/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fecha } from "@/lib/format";
import { TaskComment, TaskControls, TaskSteps } from "./task-panel";

type File = { id: string; key: string; fileName: string; mime: string; evidence: boolean };
const url = (k: string) => `/api/tareas/archivo/${k}`;

function Files({ files }: { files: File[] }) {
  if (!files.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) =>
        f.mime.startsWith("image/") ? (
          <a key={f.id} href={url(f.key)} target="_blank" rel="noreferrer" className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- archivo privado */}
            <img src={url(f.key)} alt={f.fileName} className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
            {f.evidence && <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1 text-[10px] font-semibold text-white">Evidencia</span>}
          </a>
        ) : (
          <a key={f.id} href={url(f.key)} target="_blank" rel="noreferrer" className="flex max-w-[14rem] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-brand">
            <span>{f.mime === "application/pdf" ? "📄" : "📁"}</span>
            <span className="truncate">{f.fileName}</span>
            {f.evidence && <span className="rounded bg-emerald-600 px-1 text-[10px] font-semibold text-white">Evidencia</span>}
          </a>
        ),
      )}
    </div>
  );
}

/** Detalle de una tarea; 404 si no eres quien la asignó ni quien la tiene. */
export async function TaskDetail({ id, userId, base }: { id: string; userId: string; base: string }) {
  const t = await getTaskFor(prisma, id, userId);
  if (!t) notFound();
  const now = new Date();
  const open = ["PENDIENTE", "EN_PROCESO", "EN_REVISION"].includes(t.status);
  const late = t.dueAt && t.dueAt < now && ["PENDIENTE", "EN_PROCESO"].includes(t.status);
  const initialFiles = t.files.filter((f) => !f.eventId);
  const evidence = t.files.filter((f) => f.evidence);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={base} className="text-sm text-brand hover:underline">← Tareas</Link>
      <PageHeader
        eyebrow={taskFolio(t.number)}
        title={t.title}
        actions={t.isCreator && open ? <Link href={`${base}/${t.id}/editar`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Editar</Link> : undefined}
      >
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={TASK_STATUS[t.status][1]}>{TASK_STATUS[t.status][0]}</Badge>
          <Badge tone={TASK_PRIORITY[t.priority][1]}>Prioridad {TASK_PRIORITY[t.priority][0].toLowerCase()}</Badge>
          {t.dueAt && <span className={late ? "font-semibold text-red-600" : ""}>{late ? "⚠️ Venció " : "📅 Para el "}{fmtDue(t.dueAt)}</span>}
        </span>
      </PageHeader>

      <Card>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Asignó</dt><dd>{t.createdBy.name}{t.isCreator ? " (tú)" : ""}</dd></div>
          <div><dt className="text-slate-500">La tiene</dt><dd>{t.assignee.name}{t.isAssignee ? " (tú)" : ""}</dd></div>
          <div><dt className="text-slate-500">Creada</dt><dd>{fecha(t.createdAt)}</dd></div>
          <div><dt className="text-slate-500">Al terminar</dt><dd>{[t.requiresEvidence ? "pide evidencia" : "sin evidencia", t.requiresApproval ? "la revisa quien la asignó" : "se cierra sola"].join(" · ")}</dd></div>
          {t.completedAt && <div><dt className="text-slate-500">Completada</dt><dd>{fecha(t.completedAt)}</dd></div>}
        </dl>
        {t.description && <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm">{t.description}</p>}
        <Files files={initialFiles} />
      </Card>

      {t.checklist.length > 0 && (
        <Card title={`Pasos · ${t.checklist.filter((s) => s.done).length}/${t.checklist.length}`}>
          <TaskSteps taskId={t.id} steps={t.checklist} editable={open} />
        </Card>
      )}

      <TaskControls taskId={t.id} status={t.status} isCreator={t.isCreator} isAssignee={t.isAssignee} requiresEvidence={t.requiresEvidence} pendingSteps={t.checklist.filter((s) => !s.done).length} selfTask={t.createdById === t.assigneeId} />

      {evidence.length > 0 && <Card title="Evidencia"><Files files={evidence} /></Card>}

      <Card title="Seguimiento">
        <ol className="space-y-3">
          {t.events.map((e) => (
            <li key={e.id} className={`rounded-lg px-3 py-2 text-sm ${e.kind === "comment" || e.kind === "evidence" ? "bg-slate-50" : ""}`}>
              <p className="text-xs text-slate-500">
                <strong className="text-slate-700">{e.author?.name ?? "Sistema"}</strong> · {fecha(e.createdAt)}
                {e.kind === "created" && " · creó la tarea"}
                {e.toStatus && e.kind !== "created" && <> · {e.kind === "evidence" ? "terminó y mandó evidencia" : "cambió a"} <Badge tone={TASK_STATUS[e.toStatus][1]}>{TASK_STATUS[e.toStatus][0]}</Badge></>}
                {(e.kind === "edit" || e.kind === "checklist") && ` · ${e.body}`}
              </p>
              {e.body && e.kind !== "edit" && e.kind !== "checklist" && <p className="mt-1 whitespace-pre-wrap break-words">{e.body}</p>}
              <Files files={e.files} />
            </li>
          ))}
        </ol>
        <div className="mt-4 border-t border-slate-100 pt-4"><TaskComment taskId={t.id} /></div>
      </Card>
    </div>
  );
}
