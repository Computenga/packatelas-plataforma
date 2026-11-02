"use client";

import { useActionState } from "react";
import { requestResetAction, type ResetState } from "../actions";

export function ResetRequestForm({ u }: { u?: string }) {
  const [s, action, pending] = useActionState<ResetState, FormData>(requestResetAction, {});
  if (s.sent) {
    return <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">Te mandamos un enlace a <strong>{s.sent}</strong>. Ábrelo en la próxima hora para crear tu contraseña nueva (revisa también «Spam»).</p>;
  }
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Número de cliente, usuario o correo</span>
        <input name="id" required defaultValue={u ?? ""} autoCapitalize="none" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base" />
      </label>
      {s.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">{pending ? "Enviando…" : "Mandarme el enlace"}</button>
    </form>
  );
}
