"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Checkbox, Field, FormMessage, Select, TextArea } from "@/components/ui";
import { FileInput } from "./file-input";
import { postTask } from "./post";

type Person = { id: string; name: string; detail?: string };
export type TaskFormValues = {
  title: string; description: string; assigneeId: string; priority: string; dueDate: string; dueTime: string;
  requiresEvidence: boolean; requiresApproval: boolean; checklist: string;
};

/** Alta y edición. `taskId` presente = editar (sin archivos; se agregan en los comentarios). */
export function TaskForm({ people, me, base, taskId, initial }: { people: Person[]; me: string; base: string; taskId?: string; initial?: TaskFormValues }) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string }>({});
  const [pending, start] = useTransition();
  const [assignee, setAssignee] = useState(initial?.assigneeId ?? "");
  const self = assignee === me;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (taskId) fd.set("op", "edit");
    start(async () => {
      const r = await postTask(taskId ? `/api/tareas/${taskId}` : "/api/tareas", fd);
      if (r.error) return setState({ error: r.error });
      router.push(taskId ? `${base}/${taskId}` : (r.url ?? base));
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="¿Qué hay que hacer?" name="title" required minLength={3} maxLength={200} defaultValue={initial?.title} placeholder="Ej. Inventario de insumos de bodega" />
      <TextArea label="Detalle (opcional)" name="description" rows={4} maxLength={5000} defaultValue={initial?.description} placeholder="Instrucciones, contexto, a quién llamar…" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Asignar a" name="assigneeId" required value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="" disabled>Elige a la persona…</option>
          <option value={me}>Yo mismo (pendiente personal)</option>
          {people.filter((p) => p.id !== me).map((p) => <option key={p.id} value={p.id}>{p.name}{p.detail ? ` · ${p.detail}` : ""}</option>)}
        </Select>
        <Select label="Prioridad" name="priority" defaultValue={initial?.priority ?? "NORMAL"}>
          <option value="BAJA">Baja</option>
          <option value="NORMAL">Normal</option>
          <option value="ALTA">Alta</option>
          <option value="URGENTE">Urgente</option>
        </Select>
        <Field label="Fecha objetivo" name="dueDate" type="date" defaultValue={initial?.dueDate} />
        <Field label="Hora (opcional)" name="dueTime" type="time" defaultValue={initial?.dueTime} hint="Sin hora = durante ese día" />
      </div>
      <TextArea label="Pasos (opcional, uno por renglón)" name="checklist" rows={3} defaultValue={initial?.checklist} placeholder={"Contar cajas\nTomar foto del anaquel"} />
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <Checkbox label="Pedir evidencia al terminar (nota + foto o archivo)" name="requiresEvidence" defaultChecked={initial?.requiresEvidence ?? true} />
        {!self && <Checkbox label="Revisarla yo antes de darla por completada" name="requiresApproval" defaultChecked={initial?.requiresApproval ?? true} />}
      </div>
      {!taskId && <FileInput label="Adjuntar archivos (instrucciones, fotos, formatos)" />}
      <p className="text-xs text-slate-500">Solo tú y la persona asignada pueden ver esta tarea.</p>
      <FormMessage state={state} />
      <button disabled={pending} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50 sm:w-auto sm:px-6">
        {pending ? "Guardando…" : taskId ? "Guardar cambios" : "Asignar tarea"}
      </button>
    </form>
  );
}
