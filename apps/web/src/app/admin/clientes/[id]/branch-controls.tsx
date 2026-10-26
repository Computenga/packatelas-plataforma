"use client";

import { useState, useTransition } from "react";
import { reactivateBranchAction, removeBranchAction } from "../actions";

/** Quitar (con confirmación en dos pasos) o reactivar una sucursal. */
export function BranchControls({ clientId, branchId, active }: { clientId: string; branchId: string; active: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) => start(async () => { setMsg(await fn()); setConfirm(false); });

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {!active ? (
        <button type="button" disabled={pending} onClick={() => run(() => reactivateBranchAction(clientId, branchId))} className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50">Reactivar</button>
      ) : confirm ? (
        <>
          <span className="text-slate-600">¿Quitar esta sucursal?</span>
          <button type="button" disabled={pending} onClick={() => run(() => removeBranchAction(clientId, branchId))} className="rounded-md bg-red-600 px-2 py-1 font-medium text-white disabled:opacity-50">Sí, quitar</button>
          <button type="button" onClick={() => setConfirm(false)} className="text-slate-500">Cancelar</button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="rounded-md border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50">Quitar</button>
      )}
      {msg.error && <span role="alert" className="text-red-700">{msg.error}</span>}
      {msg.ok && <span role="status" className="text-emerald-700">{msg.ok}</span>}
    </div>
  );
}
