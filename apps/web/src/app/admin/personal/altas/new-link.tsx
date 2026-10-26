"use client";

import { useActionState } from "react";
import { HIRE_ROLES } from "@packatelas/db/onboarding-roles";
import { newLinkAction } from "./actions";

export function NewLink() {
  const [state, action, pending] = useActionState(newLinkAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-medium">Puesto
          <select name="role" className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(HIRE_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Crear enlace</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.link && (
        <div role="status" className="space-y-1 rounded-lg bg-emerald-50 p-3 text-sm">
          <p className="text-emerald-800">{state.ok}</p>
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-xs" aria-label="Enlace de alta" />
        </div>
      )}
    </form>
  );
}
