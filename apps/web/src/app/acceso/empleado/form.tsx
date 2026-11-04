"use client";

import Link from "next/link";
import { useActionState } from "react";
import { completeEmpAccessAction, startEmpAccessAction, type EmpAccessState } from "./actions";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function EmpAccessForm() {
  const [s, start, p1] = useActionState<EmpAccessState, FormData>(startEmpAccessAction, { step: "id" });
  const [c, complete, p2] = useActionState<EmpAccessState, FormData>(completeEmpAccessAction, {});

  if (s.step === "password" && s.token) {
    return (
      <form action={complete} className="space-y-4">
        <p className="text-sm">Hola <strong>{s.name}</strong>. Crea tu contraseña. Para entrar después usarás tu <strong>RFC</strong> y esta contraseña.</p>
        <input type="hidden" name="token" value={s.token} />
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Contraseña nueva</span>
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
          <span className="mt-1 block text-xs text-slate-500">Mínimo 8 caracteres, con letras y números.</span>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Repítela</span>
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={input} />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Correo (opcional)</span>
          <input name="email" type="email" autoComplete="email" className={input} />
          <span className="mt-1 block text-xs text-slate-500">Para recuperar tu contraseña si la olvidas.</span>
        </label>
        {c.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{c.error}</p>}
        <button disabled={p2} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">{p2 ? "Guardando…" : "Crear contraseña y entrar"}</button>
      </form>
    );
  }

  return (
    <form action={start} className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">RFC</span>
        <input name="rfc" required defaultValue={s.rfc ?? ""} placeholder="LOAS840319IF1" autoCapitalize="characters" autoComplete="username" className={`${input} font-mono uppercase`} />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Número de empleado</span>
        <input name="no" required defaultValue={s.no ?? ""} inputMode="numeric" pattern="\d{1,6}" placeholder="92" className={input} />
        <span className="mt-1 block text-xs text-slate-500">El mismo con el que checas en el reloj.</span>
      </label>
      {s.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p>}
      {s.already && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Tu cuenta ya está activa. Entra con el usuario <strong className="font-mono">{s.already}</strong> y tu contraseña.{" "}
          <Link href="/login" className="font-semibold underline">Entrar</Link> ·{" "}
          <Link href={`/acceso/restablecer?u=${encodeURIComponent(s.already)}`} className="font-semibold underline">La olvidé</Link>
        </p>
      )}
      <button disabled={p1} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">{p1 ? "Revisando…" : "Continuar"}</button>
    </form>
  );
}
