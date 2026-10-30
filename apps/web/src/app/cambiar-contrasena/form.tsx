"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangeState } from "./actions";

export function ChangeForm() {
  const [state, action, pending] = useActionState<ChangeState, FormData>(changePasswordAction, {});
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm">Contraseña temporal (la que te dieron)<input name="current" type="password" autoComplete="current-password" required className={input} /></label>
      <label className="block text-sm">Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={8} required className={input} /></label>
      <label className="block text-sm">Repite la nueva contraseña<input name="confirm" type="password" autoComplete="new-password" minLength={8} required className={input} /></label>
      <p className="text-xs text-slate-500">Mínimo 8 caracteres, con letras y números.</p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-brand py-2.5 font-semibold text-white disabled:opacity-50">{pending ? "Guardando…" : "Guardar y volver a entrar"}</button>
    </form>
  );
}
