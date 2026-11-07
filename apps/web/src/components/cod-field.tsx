"use client";

import { useState } from "react";

/** Casilla «Cobrar a la entrega» con el importe que el repartidor cobra al destinatario. */
export function CodField() {
  const [on, setOn] = useState(false);
  return (
    <div className={`rounded-lg border p-3 ${on ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="cod" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4 accent-brand" />
        Cobrar a la entrega (pago contra entrega)
      </label>
      {on && (
        <label className="mt-2 block text-sm">
          <span className="text-slate-700">Importe que el repartidor le cobra al destinatario</span>
          <span className="mt-1 flex items-center gap-1">
            <span className="text-lg font-bold">$</span>
            <input name="codAmount" inputMode="decimal" required placeholder="0.00" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-lg font-bold tabular-nums" />
            <span className="text-sm text-slate-500">MXN</span>
          </span>
          <span className="mt-1 block text-xs text-slate-500">La guía saldrá marcada «POR COBRAR» con este importe.</span>
        </label>
      )}
    </div>
  );
}
