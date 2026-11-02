"use client";

import { useActionState } from "react";
import type { ActionState } from "./action-form";
import { FormMessage } from "./ui";

const ymdMx = (days: number) => {
  const d = new Date(Date.now() + days * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);
};

/** Exención de bloqueo por adeudo hasta una fecha (solo administradores). */
export function ExemptionForm({ action, compact = false, current }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; compact?: boolean; current?: string | null }) {
  const [state, run, pending] = useActionState(action, {});
  const quick = [
    { label: "Hoy", ymd: ymdMx(0) },
    { label: "3 días", ymd: ymdMx(3) },
    { label: "1 semana", ymd: ymdMx(7) },
  ];
  return (
    <form action={run} className={compact ? "space-y-2 text-xs" : "space-y-3 text-sm"}>
      {current && <p className="text-blue-700">Exento hasta {current}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-slate-600">Exento hasta</span>
          <input type="date" name="until" required min={ymdMx(0)} className="mt-0.5 block rounded border border-slate-300 px-2 py-1" />
        </label>
        <input name="note" required minLength={3} maxLength={200} placeholder="Motivo (p. ej. acuerdo de pago)" className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1" />
        <button disabled={pending} className="rounded bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-50">{pending ? "…" : "Exentar"}</button>
      </div>
      <div className="flex flex-wrap gap-1 text-slate-500">
        Rápido:
        {quick.map((q) => (
          <button key={q.label} type="button" className="rounded border border-slate-200 px-1.5 hover:bg-slate-50"
            onClick={(e) => { const f = e.currentTarget.form!; (f.elements.namedItem("until") as HTMLInputElement).value = q.ymd; }}>
            {q.label}
          </button>
        ))}
      </div>
      <FormMessage state={state} />
    </form>
  );
}
