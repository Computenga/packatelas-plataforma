"use client";

/** Puente que expone la app Android (window.PackatelasNative). */
export type NativeBridge = { setOnDuty: (on: boolean) => void; hasLocation: () => boolean; locationStatus?: () => string; openLocationSettings?: () => void };
export const nativeBridge = () => (typeof window !== "undefined" ? (window as Window & { PackatelasNative?: NativeBridge }).PackatelasNative : undefined);

/** Estado de ubicación que no deja trabajar (app nativa). */
export const NATIVE_BLOCKING: Record<string, { title: string; steps: string[] }> = {
  denied: { title: "La app no tiene permiso de ubicación", steps: ["Toca «Abrir ajustes».", "Entra a Permisos → Ubicación.", "Elige «Permitir todo el tiempo» y activa «Usar ubicación precisa».", "Regresa a la app."] },
  gps_off: { title: "La ubicación del teléfono está apagada", steps: ["Desliza desde arriba de la pantalla.", "Enciende «Ubicación».", "Regresa a la app."] },
  approx: { title: "Solo diste ubicación aproximada", steps: ["Toca «Abrir ajustes».", "Entra a Permisos → Ubicación.", "Activa «Usar ubicación precisa».", "Regresa a la app."] },
  foreground: { title: "Falta «Permitir todo el tiempo»", steps: ["Toca «Abrir ajustes».", "Entra a Permisos → Ubicación.", "Elige «Permitir todo el tiempo» (si no, se detiene al bloquear el teléfono).", "Regresa a la app."] },
};

const WEB_STEPS = {
  android: ["Toca el candado (🔒) junto a la dirección arriba.", "Entra a «Permisos» → «Ubicación» y elige «Permitir».", "Enciende la ubicación del teléfono.", "Toca «Ya lo activé»."],
  iphone: ["Abre Ajustes del iPhone → Privacidad y seguridad → Localización: que esté encendida.", "En esa lista, Safari → «Al usar la app» y «Ubicación exacta» encendida.", "En Safari toca «aA» → Configuración del sitio web → Ubicación → Permitir.", "Toca «Ya lo activé»."],
};

/** Pantalla que bloquea la app hasta que el repartidor arregle la ubicación. */
export function LocationBlock({ title, steps, onRetry, retryLabel = "Ya lo activé", native, extra }: {
  title: string; steps?: string[]; onRetry: () => void; retryLabel?: string; native?: NativeBridge; extra?: React.ReactNode;
}) {
  const iphone = typeof navigator !== "undefined" && /iPhone|iPad/i.test(navigator.userAgent);
  const list = steps ?? (iphone ? WEB_STEPS.iphone : WEB_STEPS.android);
  return (
    <div role="alertdialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] flex flex-col bg-brand p-6 text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5">
        <p className="text-5xl" aria-hidden>📍</p>
        <h2 className="font-display text-4xl leading-none font-black">{title}</h2>
        <p className="text-slate-300">Sin tu ubicación despacho no puede ver dónde vas ni ordenar tu ruta. Mientras no la actives no puedes trabajar en la app.</p>
        <ol className="space-y-2">
          {list.map((s, i) => (
            <li key={i} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-brand">{i + 1}</span><span>{s}</span></li>
          ))}
        </ol>
        {extra}
        <div className="grid gap-2">
          {native?.openLocationSettings && (
            <button type="button" onClick={() => native.openLocationSettings?.()} className="rounded-xl bg-accent py-4 text-lg font-bold text-brand">Abrir ajustes</button>
          )}
          <button type="button" onClick={onRetry} className={`rounded-xl py-4 text-lg font-bold ${native?.openLocationSettings ? "border-2 border-white/40" : "bg-accent text-brand"}`}>{retryLabel}</button>
        </div>
      </div>
    </div>
  );
}
