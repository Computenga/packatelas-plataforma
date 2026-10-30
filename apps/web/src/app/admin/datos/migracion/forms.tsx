"use client";

import { useActionState, type ReactNode } from "react";
import type { MigState } from "./actions";

export function MigForm({ action, label, children }: { action: (s: MigState, fd: FormData) => Promise<MigState>; label: string; children: ReactNode }) {
  const [state, run, pending] = useActionState<MigState, FormData>(action, {});
  return (
    <form action={run} className="space-y-3">
      {children}
      <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Procesando…" : label}</button>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-result="ok">{state.ok}</p>}
      {state.detail && state.detail.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Detalle ({state.detail.length})</summary>
          <ul className="mt-1 max-h-60 overflow-auto font-mono">{state.detail.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      )}
    </form>
  );
}
