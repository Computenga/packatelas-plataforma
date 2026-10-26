"use client";

import { useActionState } from "react";
import { verifyLogin } from "./actions";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyLogin, {});
  return (
    <form action={action} className="space-y-4">
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        aria-label="Código"
        className="w-full rounded-lg border border-slate-300 px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-brand py-2.5 font-semibold text-white disabled:opacity-50">
        {pending ? "Verificando…" : "Entrar"}
      </button>
    </form>
  );
}
