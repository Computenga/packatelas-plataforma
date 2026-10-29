"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/components/action-form";

/** Botón que llama una acción del servidor y muestra el resultado en línea. */
export function ActButton({ action, label, busy = "Timbrando…" }: { action: () => Promise<ActionState>; label: string; busy?: string }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionState>({});
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" disabled={pending} onClick={() => start(async () => setR(await action()))} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">
        {pending ? busy : label}
      </button>
      {r.error && <span className="mt-1 max-w-xs text-xs text-red-700">{r.error}</span>}
      {r.ok && <span className="mt-1 text-xs text-emerald-700">{r.ok}</span>}
    </span>
  );
}
