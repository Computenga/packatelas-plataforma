"use client";

import { useActionState } from "react";
import { mlImportAction, type MlImportState } from "./actions";

const TONE = { nueva: "text-emerald-700", mover: "text-amber-700", igual: "text-slate-500" } as const;

export function MlImportForm() {
  const [state, action, pending] = useActionState<MlImportState, FormData>(mlImportAction, {});
  const errors = state.plan?.filter((p) => p.error).length ?? 0;
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium text-slate-700">Cuentas (Vendedor ML, Cuenta, ID cliente)
        <textarea name="text" rows={10} defaultValue={state.text} key={state.text ?? "empty"} spellCheck={false}
          placeholder={"Vendedor ML,Cuenta,ID cliente\n459730191,PRODUPML,cmx00151"}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm font-medium text-emerald-700">{state.ok}</p>}
      <div className="flex gap-2">
        <button name="mode" value="review" disabled={pending} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">Revisar</button>
        {state.plan && !errors && (
          <button name="mode" value="import" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Importando…" : `Importar ${state.plan.length}`}
          </button>
        )}
      </div>
      {state.plan && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm">
            {state.plan.filter((p) => p.action === "nueva" && !p.error).length} nuevas · {state.plan.filter((p) => p.action === "mover" && !p.error).length} cambian de cliente
            {errors > 0 && <span className="text-red-700"> · {errors} con error (corrige y vuelve a revisar)</span>}
          </p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Renglón</th><th className="px-3 py-2">Vendedor</th><th className="px-3 py-2">Cuenta</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Acción</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {state.plan.map((p) => (
                <tr key={p.line} className={p.error ? "bg-red-50" : ""}>
                  <td className="px-3 py-1.5 text-slate-500">{p.line}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{p.row.sellerId}</td>
                  <td className="px-3 py-1.5">{p.row.nickname}</td>
                  <td className="px-3 py-1.5">{p.clientName ? `${p.clientName} (${p.row.publicId})` : p.row.publicId}</td>
                  <td className={`px-3 py-1.5 ${p.error ? "text-red-700" : TONE[p.action]}`}>{p.error ?? (p.action === "mover" ? "Cambia de cliente" : p.action === "nueva" ? "Nueva" : "Sin cambio")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
