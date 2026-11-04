"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/ui";
import { FileInput } from "./file-input";
import { postTask } from "./post";

function useTaskPost(taskId: string) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const send = (fd: FormData, onOk?: () => void, onErr?: () => void) =>
    start(async () => {
      const r = await postTask(`/api/tareas/${taskId}`, fd);
      if (r.error) {
        setState({ error: r.error });
        return onErr?.();
      }
      setState({});
      onOk?.();
      router.refresh();
    });
  return { state, pending, send };
}

export function TaskSteps({ taskId, steps, editable }: { taskId: string; steps: { id: string; text: string; done: boolean }[]; editable: boolean }) {
  const { state, send } = useTaskPost(taskId);
  // Se marca al instante; si el servidor lo rechaza, la recarga lo deja como estaba.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const isDone = (s: { id: string; done: boolean }) => local[s.id] ?? s.done;
  return (
    <>
      <ul className="space-y-2">
        {steps.map((s) => (
          <li key={s.id}>
            <label className={`flex items-start gap-3 text-sm ${isDone(s) ? "text-slate-400 line-through" : ""}`}>
              <input
                type="checkbox" checked={isDone(s)} disabled={!editable} className="mt-0.5 h-5 w-5 accent-brand"
                onChange={(e) => {
                  const done = e.target.checked;
                  setLocal((m) => ({ ...m, [s.id]: done }));
                  const fd = new FormData(); fd.set("op", "step"); fd.set("stepId", s.id); fd.set("done", done ? "1" : "0");
                  const clear = () => setLocal((m) => { const n = { ...m }; delete n[s.id]; return n; });
                  send(fd, clear, clear);
                }}
              />
              {s.text}
            </label>
          </li>
        ))}
      </ul>
      <FormMessage state={state} />
    </>
  );
}

/** Botones según quién eres y en qué va la tarea. */
export function TaskControls({ taskId, status, isCreator, isAssignee, requiresEvidence, pendingSteps, selfTask }: {
  taskId: string; status: string; isCreator: boolean; isAssignee: boolean; requiresEvidence: boolean; pendingSteps: number; selfTask: boolean;
}) {
  const { state, pending, send } = useTaskPost(taskId);
  const [mode, setMode] = useState<"" | "submit" | "return">("");
  const act = (action: string, extra?: FormData) => {
    const fd = extra ?? new FormData();
    fd.set("op", "action");
    fd.set("action", action);
    send(fd, () => setMode(""));
  };
  const onForm = (action: string) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); act(action, new FormData(e.currentTarget)); };
  const btn = "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50";
  const open = ["PENDIENTE", "EN_PROCESO"].includes(status);

  const buttons = [
    isAssignee && status === "PENDIENTE" && <button key="s" disabled={pending} onClick={() => act("start")} className={`${btn} border border-slate-300 bg-white`}>▶ Empezar</button>,
    isAssignee && open && <button key="d" disabled={pending} onClick={() => setMode(mode === "submit" ? "" : "submit")} className={`${btn} bg-emerald-600 text-white`}>✓ Terminé</button>,
    isCreator && !selfTask && status === "EN_REVISION" && <button key="a" disabled={pending} onClick={() => act("approve")} className={`${btn} bg-emerald-600 text-white`}>✓ Aprobar y cerrar</button>,
    isCreator && !selfTask && status === "EN_REVISION" && <button key="r" disabled={pending} onClick={() => setMode(mode === "return" ? "" : "return")} className={`${btn} border border-amber-400 bg-amber-50 text-amber-900`}>↩ Regresar con observaciones</button>,
    isCreator && ["PENDIENTE", "EN_PROCESO", "EN_REVISION"].includes(status) && <button key="c" disabled={pending} onClick={() => { if (confirm("¿Cancelar esta tarea?")) act("cancel"); }} className={`${btn} text-red-600`}>Cancelar tarea</button>,
    isCreator && ["COMPLETADA", "CANCELADA"].includes(status) && <button key="o" disabled={pending} onClick={() => act("reopen")} className={`${btn} border border-slate-300 bg-white`}>Reabrir</button>,
  ].filter(Boolean);
  if (!buttons.length) return null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      {status === "EN_REVISION" && isAssignee && !isCreator && <p className="text-sm text-amber-800">Mandaste tu evidencia; falta que quien te la asignó la revise.</p>}
      <div className="flex flex-wrap gap-2">{buttons}</div>
      {mode === "submit" && (
        <form onSubmit={onForm("submit")} className="space-y-3 border-t border-slate-100 pt-3">
          {pendingSteps > 0 && <p className="text-sm text-amber-800">Te faltan {pendingSteps} paso(s) de la lista por marcar.</p>}
          <textarea name="note" rows={3} required={requiresEvidence} maxLength={3000} placeholder={requiresEvidence ? "¿Qué hiciste? (obligatorio)" : "Comentario (opcional)"} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <FileInput label={requiresEvidence ? "Foto o archivo de evidencia (obligatorio)" : "Adjuntar evidencia (opcional)"} />
          <button disabled={pending} className={`${btn} bg-emerald-600 text-white`}>{pending ? "Enviando…" : "Mandar como terminada"}</button>
        </form>
      )}
      {mode === "return" && (
        <form onSubmit={onForm("return")} className="space-y-3 border-t border-slate-100 pt-3">
          <textarea name="note" rows={3} required minLength={3} maxLength={3000} placeholder="¿Qué falta o qué hay que corregir?" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <FileInput />
          <button disabled={pending} className={`${btn} bg-amber-500 text-white`}>{pending ? "Enviando…" : "Regresar tarea"}</button>
        </form>
      )}
      <FormMessage state={state} />
    </div>
  );
}

export function TaskComment({ taskId }: { taskId: string }) {
  const { state, pending, send } = useTaskPost(taskId);
  const [k, setK] = useState(0);
  return (
    <form
      key={k}
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("op", "comment"); send(fd, () => setK((x) => x + 1)); }}
      className="space-y-2"
    >
      <textarea name="body" rows={2} maxLength={3000} placeholder="Escribe un comentario o avance…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FileInput />
        <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Enviando…" : "Comentar"}</button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
