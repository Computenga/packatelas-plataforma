"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signup, type SignupState } from "./actions";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
const CHANNELS = ["MercadoLibre", "Tiendanube", "Shopify", "WooCommerce", "Redes sociales", "Otro"];

function F({ label, name, v, hint, ...rest }: { label: string; name: string; v?: Record<string, string>; hint?: string } & React.ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input name={name} defaultValue={v?.[name]} className={input} {...rest} />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signup, {});
  const v = state.values;
  const channels = new Set((v?.salesChannels ?? "").split(", ").filter(Boolean));

  return (
    <form action={action} className="space-y-6" key={JSON.stringify(v ?? {})}>
      <fieldset className="space-y-4">
        <legend className="mb-2 font-semibold">Tu negocio</legend>
        <F label="Nombre de la tienda o negocio" name="businessName" v={v} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Tu nombre" name="contactName" v={v} required autoComplete="name" />
          <F label="WhatsApp" name="phone" v={v} required inputMode="tel" autoComplete="tel" hint="10 dígitos" />
        </div>
        <F label="Correo" name="email" type="email" v={v} required autoComplete="email" />
        <div>
          <span className="text-sm font-medium text-slate-700">¿Dónde vendes?</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
                <input type="checkbox" name="salesChannels" value={c} defaultChecked={channels.has(c)} className="accent-brand" /> {c}
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Envíos aproximados al mes</span>
          <select name="monthlyVolume" defaultValue={v?.monthlyVolume ?? ""} className={input}>
            <option value="">Selecciona</option>
            <option>Menos de 50</option>
            <option>50 a 200</option>
            <option>200 a 500</option>
            <option>Más de 500</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-semibold">Recolección</legend>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">¿Dónde recolectamos?</span>
          <select name="zone" required defaultValue={v?.zone ?? ""} className={input}>
            <option value="" disabled>Selecciona</option>
            <option value="cmx">Ciudad de México</option>
            <option value="emx">Estado de México</option>
          </select>
        </label>
        <F label="Dirección de recolección" name="pickupAddress" v={v} required hint="Calle, número, colonia, alcaldía o municipio y CP" autoComplete="street-address" />
        <F label="Referencias (opcional)" name="pickupReference" v={v} hint="Entre calles, color de fachada, horario" />
      </fieldset>

      <details className="rounded-lg border border-slate-200 p-4" open={!!v?.rfc}>
        <summary className="cursor-pointer font-semibold">Datos de facturación (opcional)</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <F label="RFC" name="rfc" v={v} autoCapitalize="characters" />
          <F label="Razón social" name="legalName" v={v} />
          <F label="Régimen fiscal" name="taxRegime" v={v} />
          <F label="CP fiscal" name="taxZip" v={v} inputMode="numeric" maxLength={5} />
          <F label="Uso de CFDI" name="cfdiUse" v={v} placeholder="G03 Gastos en general" />
        </div>
      </details>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-semibold">Tu acceso</legend>
        <F label="Usuario" name="username" v={v} required autoCapitalize="none" autoComplete="username" hint="Sin espacios. Con él entrarás a ver tus envíos y saldo." />
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Contraseña" name="password" type="password" required minLength={8} autoComplete="new-password" />
          <F label="Repite la contraseña" name="password2" type="password" required minLength={8} autoComplete="new-password" />
        </div>
      </fieldset>

      {/* Campo trampa para bots */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="terms" required className="mt-0.5 accent-brand" />
        <span>
          Acepto los <Link href="/terminos" target="_blank" className="text-brand hover:underline">términos del servicio</Link> y el aviso de privacidad.
        </span>
      </label>

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-brand py-3 font-semibold text-white disabled:opacity-50">
        {pending ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}
