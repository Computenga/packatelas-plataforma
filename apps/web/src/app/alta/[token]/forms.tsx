"use client";

import { useActionState } from "react";
import { saveApplicationData, submitAction, type AltaState } from "../actions";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base";
type V = Record<string, string | null>;

function F({ label, name, v, ...rest }: { label: string; name: string; v: V } & React.ComponentProps<"input">) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input name={name} defaultValue={v[name] ?? ""} className={input} {...rest} /></label>;
}

export function DataForm({ token, v: saved, locked }: { token: string; v: V; locked: boolean }) {
  const [state, action, pending] = useActionState<AltaState, FormData>(saveApplicationData.bind(null, token), {});
  const v: V = state.values ?? saved;
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={locked} className="space-y-4">
        <F label="Nombre completo" name="name" v={v} required autoComplete="name" />
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Celular" name="phone" v={v} required inputMode="tel" autoComplete="tel" />
          <F label="Correo (opcional)" name="email" v={v} type="email" autoComplete="email" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="CURP" name="curp" v={v} required maxLength={18} autoCapitalize="characters" />
          <F label="RFC" name="rfc" v={v} maxLength={13} autoCapitalize="characters" />
          <F label="NSS" name="nss" v={v} maxLength={11} inputMode="numeric" />
        </div>
        <F label="Domicilio" name="address" v={v} autoComplete="street-address" />
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="CLABE para tu nómina" name="clabe" v={v} maxLength={18} inputMode="numeric" />
          <F label="Banco" name="bank" v={v} />
        </div>
        <p className="pt-2 text-sm font-medium">Contacto de emergencia</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="Nombre" name="emergencyName" v={v} />
          <F label="Teléfono" name="emergencyPhone" v={v} inputMode="tel" />
          <F label="Parentesco" name="emergencyRelation" v={v} />
        </div>
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-700">{state.ok}</p>}
      {!locked && <button disabled={pending} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Guardando…" : "Guardar datos"}</button>}
    </form>
  );
}

export function SubmitButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AltaState, FormData>(() => submitAction(token), {});
  return (
    <form action={action} className="space-y-2">
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white disabled:opacity-50">{pending ? "Enviando…" : "Enviar a revisión"}</button>
    </form>
  );
}
