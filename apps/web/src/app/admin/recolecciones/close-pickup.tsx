"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/components/action-form";
import { FormMessage } from "@/components/ui";

/** Cerrar a mano una recolección: recolectada, no se pudo o cancelar (p. ej. repetida). */
export function ClosePickup({ action, canCollect }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; canCollect: boolean }) {
  const [state, run, pending] = useActionState(action, {});
  const [what, setWhat] = useState(canCollect ? "collected" : "cancel");
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-brand">Cerrar a mano</summary>
      <form action={run} className="mt-1 w-64 space-y-1.5 whitespace-normal">
        <select name="what" value={what} onChange={(e) => setWhat(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-1 py-1">
          {canCollect && <option value="collected">Recolectada</option>}
          {canCollect && <option value="failed">No se pudo recolectar</option>}
          <option value="cancel">Cancelar (repetida u otro motivo)</option>
        </select>
        {what === "collected" && <input name="count" type="number" min={1} placeholder="Paquetes (opcional)" className="w-full rounded border border-slate-300 px-1 py-1" />}
        <input name="note" required={what !== "cancel"} minLength={what !== "cancel" ? 3 : undefined} placeholder={what === "cancel" ? "Motivo (p. ej. repetida)" : "Motivo (queda en el historial)"} className="w-full rounded border border-slate-300 px-1 py-1" />
        <button disabled={pending} className="rounded bg-brand px-2 py-1 font-medium text-white disabled:opacity-50">{pending ? "…" : "Guardar"}</button>
        <FormMessage state={state} />
      </form>
    </details>
  );
}
