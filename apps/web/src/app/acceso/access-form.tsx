"use client";

import Link from "next/link";
import { useActionState } from "react";
import { completeAccessAction, startAccessAction, type AccessState } from "./actions";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function AccessForm() {
  const [s, start, p1] = useActionState<AccessState, FormData>(startAccessAction, { step: "id" });
  const [c, complete, p2] = useActionState<AccessState, FormData>(completeAccessAction, {});

  if (s.step === "password" && s.token) {
    return (
      <form action={complete} className="space-y-4">
        <p className="text-sm">Hola <strong>{s.name}</strong>. Crea tu contraseña para entrar al portal.</p>
        <input type="hidden" name="token" value={s.token} />
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Correo</span>
          <input name="email" type="email" required autoComplete="email" className={input} />
          <span className="mt-1 block text-xs text-slate-500">Lo usamos si algún día olvidas tu contraseña.</span>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Contraseña nueva</span>
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
          <span className="mt-1 block text-xs text-slate-500">Mínimo 8 caracteres, con letras y números.</span>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Repítela</span>
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={input} />
        </label>
        {c.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{c.error}</p>}
        <button disabled={p2} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">{p2 ? "Guardando…" : "Crear contraseña y entrar"}</button>
      </form>
    );
  }

  return (
    <form action={start} className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Número de cliente</span>
        <input name="id" required defaultValue={s.id ?? ""} placeholder="cmx00114" autoCapitalize="none" autoComplete="username" className={`${input} font-mono`} />
        <span className="mt-1 block text-xs text-slate-500">Es tu ID de Packatelas (también tu referencia de pago).</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Últimos 4 dígitos de tu WhatsApp</span>
        <input name="last4" required inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="1234" className={`${input} tracking-widest`} />
        <span className="mt-1 block text-xs text-slate-500">El número con el que te registraste con nosotros. Así sabemos que eres tú.</span>
      </label>
      {s.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p>}
      {s.info && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {s.info}{" "}
          <Link href="/login" className="font-semibold underline">Entrar</Link> ·{" "}
          <Link href={`/acceso/restablecer${s.id ? `?u=${encodeURIComponent(s.id)}` : ""}`} className="font-semibold underline">Restablecer por correo</Link>
        </p>
      )}
      <button disabled={p1} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">{p1 ? "Revisando…" : "Continuar"}</button>
    </form>
  );
}
