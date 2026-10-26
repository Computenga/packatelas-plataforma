"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/components/action-form";

/** Botón que ejecuta una acción del servidor y muestra el resultado. */
export function RunButton({ run, label, variant = "primary", confirm }: { run: () => Promise<ActionState>; label: string; variant?: "primary" | "secondary" | "danger"; confirm?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});
  const [ask, setAsk] = useState(false);
  const cls = { primary: "bg-brand text-white", secondary: "border border-slate-300 bg-white", danger: "border border-red-200 text-red-700" }[variant];
  const go = () => start(async () => { setMsg(await run()); setAsk(false); });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {confirm && ask ? (
        <>
          <span className="text-sm text-slate-600">{confirm}</span>
          <button type="button" disabled={pending} onClick={go} className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${cls}`}>Sí</button>
          <button type="button" onClick={() => setAsk(false)} className="text-sm text-slate-500">Cancelar</button>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={() => (confirm ? setAsk(true) : go())} className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${cls}`}>
          {pending ? "…" : label}
        </button>
      )}
      {msg.error && <span role="alert" className="text-sm text-red-600">{msg.error}</span>}
      {msg.ok && <span role="status" className="text-sm text-emerald-700">{msg.ok}</span>}
    </span>
  );
}
