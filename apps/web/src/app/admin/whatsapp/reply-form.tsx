"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/components/action-form";

export function ReplyForm({ action, open, until }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; open: boolean; until: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state]);
  if (!open) {
    return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja responder con texto libre cuando la persona vuelve a escribir.</p>;
  }
  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <textarea name="text" rows={3} required maxLength={4000} placeholder="Escribe tu respuesta…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ref.current?.requestSubmit(); } }} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{until ? `Puedes responder hasta ${until}` : ""} · Ctrl+Enter envía</span>
        <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Enviando…" : "Enviar"}</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
