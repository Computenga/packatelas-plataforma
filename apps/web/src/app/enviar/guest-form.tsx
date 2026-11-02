"use client";

import Link from "next/link";
import { useActionState } from "react";
import { startGuest, type GuestState } from "./actions";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function F({ label, name, v, hint, ...rest }: { label: string; name: string; v?: Record<string, string>; hint?: string } & React.ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input name={name} defaultValue={v?.[name] ?? (rest.defaultValue as string | undefined)} className={input} {...rest} />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function GuestForm({ price, minDate, rule }: { price: string; minDate: string; rule: string }) {
  const [state, action, pending] = useActionState<GuestState, FormData>(startGuest, {});
  const v = state.values;
  return (
    <form action={action} className="space-y-6" key={JSON.stringify(v ?? {})}>
      <fieldset className="space-y-4">
        <legend className="mb-2 font-semibold">1. ¿Dónde recogemos?</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Tu nombre" name="senderName" v={v} required autoComplete="name" />
          <F label="Tu WhatsApp" name="senderPhone" v={v} required inputMode="tel" autoComplete="tel" hint="10 dígitos" />
        </div>
        <F label="Tu correo" name="senderEmail" type="email" v={v} required autoComplete="email" hint="Ahí te llega el comprobante de pago" />
        <F label="Dirección de recolección" name="pickupAddress" v={v} required placeholder="Calle, número, colonia, alcaldía o municipio, CP" />
        <F label="Referencias (opcional)" name="pickupReference" v={v} placeholder="Portón negro, tocar timbre 2…" />
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Día de recolección</span>
          <input type="date" name="pickupDate" required min={minDate} defaultValue={v?.pickupDate ?? minDate} className={input} />
          <span className="mt-1 block text-xs text-slate-500">{rule}</span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-semibold">2. ¿A quién se entrega?</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Nombre de quien recibe" name="recipientName" v={v} required />
          <F label="Teléfono de quien recibe" name="recipientPhone" v={v} required inputMode="tel" hint="10 dígitos" />
        </div>
        <F label="Calle y número" name="addressLine" v={v} required />
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="Colonia" name="neighborhood" v={v} />
          <F label="Alcaldía o municipio" name="city" v={v} required />
          <F label="Código postal" name="zip" v={v} required inputMode="numeric" maxLength={5} />
        </div>
        <F label="Indicaciones para la entrega (opcional)" name="instructions" v={v} placeholder="Entre calles, horario, dejar en recepción…" />
        <F label="¿Qué envías?" name="contents" v={v} required placeholder="Caja con ropa, sobre con documentos…" hint="Un paquete por envío. Sin artículos prohibidos ni peligrosos." />
      </fieldset>

      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="terms" required className="mt-1 accent-brand" defaultChecked={v?.terms === "on"} />
        <span>
          Acepto los <Link href="/terminos" target="_blank" className="text-brand underline">términos del servicio</Link> y el{" "}
          <Link href="/privacidad" target="_blank" className="text-brand underline">aviso de privacidad</Link>.
        </span>
      </label>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white disabled:opacity-50">
        {pending ? "Abriendo el pago…" : `Pagar ${price} con tarjeta`}
      </button>
      <p className="text-center text-xs text-slate-500">Pago seguro con Mercado Pago. Al confirmarse agendamos tu recolección.</p>
    </form>
  );
}
