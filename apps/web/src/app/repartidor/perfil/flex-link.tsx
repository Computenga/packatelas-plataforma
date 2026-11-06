"use client";

import { useState, useTransition } from "react";
import { Scanner } from "@/components/scanner";
import { FormMessage } from "@/components/ui";
import type { ActionState } from "@/components/action-form";
import { selfLinkFlex } from "./actions";

/** Escanear una etiqueta Flex que ya trae asignada para ligar su ID de driver de ML. */
export function FlexLink({ onLinked }: { onLinked?: () => void } = {}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const go = (raw: string) => start(async () => {
    const r = await selfLinkFlex(raw);
    setState(r);
    if (r.ok && onLinked) setTimeout(onLinked, 1800);
  });

  if (state.ok) return <FormMessage state={state} />;
  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>En tu app <strong>Flex de Mercado Libre</strong>, escanea un paquete (que quede a tu nombre).</li>
        <li>Aquí, escanea la etiqueta de ese mismo paquete.</li>
      </ol>
      {open ? (
        <Scanner onScan={go} busy={pending} />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">Escanear etiqueta Flex</button>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) go(manual.trim()); }} className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value)} inputMode="numeric" placeholder="o escribe el número de envío" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button disabled={pending} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{pending ? "…" : "Vincular"}</button>
      </form>
      <FormMessage state={state} />
    </div>
  );
}
