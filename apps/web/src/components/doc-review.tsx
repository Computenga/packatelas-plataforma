"use client";

import { useState, useTransition } from "react";
import { reviewDocAction } from "@/app/admin/personal/altas/actions";

/** Botones de RH para aprobar o rechazar (con motivo) un documento. */
export function DocReview({ docId, status }: { docId: string; status: "PENDIENTE" | "APROBADO" | "RECHAZADO" }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const go = (s: "APROBADO" | "RECHAZADO") => start(async () => {
    const r = await reviewDocAction(docId, s, comment);
    setMsg(r.error ?? null);
    if (!r.error) setRejecting(false);
  });
  if (rejecting) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Qué debe corregir" aria-label="Motivo del rechazo" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:w-56" autoFocus />
        <button disabled={pending} onClick={() => go("RECHAZADO")} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Rechazar</button>
        <button onClick={() => setRejecting(false)} className="text-sm text-slate-500">Cancelar</button>
        {msg && <p role="alert" className="w-full text-xs text-red-700">{msg}</p>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {status !== "APROBADO" && <button disabled={pending} onClick={() => go("APROBADO")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Aprobar</button>}
      {status !== "RECHAZADO" && <button disabled={pending} onClick={() => setRejecting(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">Rechazar</button>}
      {msg && <p role="alert" className="text-xs text-red-700">{msg}</p>}
    </div>
  );
}
