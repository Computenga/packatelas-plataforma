"use client";

import { useActionState } from "react";
import { newPasswordAction, type ResetState } from "../actions";

export function NewPasswordForm({ token }: { token: string }) {
  const [s, action, pending] = useActionState<ResetState, FormData>(newPasswordAction, {});
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Contraseña nueva</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
        <span className="mt-1 block text-xs text-slate-500">Mínimo 8 caracteres, con letras y números.</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Repítela</span>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={input} />
      </label>
      {s.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">{pending ? "Guardando…" : "Guardar contraseña"}</button>
    </form>
  );
}
