"use client";

import { useActionState } from "react";
import type { ActionState } from "@/components/action-form";

/** Precio del portal en línea: vacío = el de WooCommerce. */
export function PriceForm({ action, current, woo }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; current: string; woo: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1 text-slate-600">
        Precio portal $
        <input name="price" inputMode="decimal" defaultValue={current} placeholder={woo} aria-label="Precio en el portal (vacío = el de WooCommerce)"
          className="w-24 rounded border border-slate-300 px-2 py-1 text-right tabular-nums" />
      </label>
      <button disabled={pending} className="rounded bg-brand px-2 py-1 font-medium text-white disabled:opacity-50">{pending ? "…" : "Guardar"}</button>
      {state.error && <span className="text-red-700">{state.error}</span>}
      {state.ok && !pending && <span className="text-emerald-700">{state.ok}</span>}
    </form>
  );
}
