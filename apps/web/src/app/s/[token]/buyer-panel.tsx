"use client";

import { useActionState, useState } from "react";
import { noteAction, problemAction, rescheduleAction, verifyAction, type BuyerState } from "./actions";

type Props = {
  token: string;
  verified: boolean;
  open: boolean;
  delivered: boolean;
  hasPhone: boolean;
  dates: { ymd: string; label: string }[];
  problems: readonly { key: string; label: string }[];
  code: string;
  whatsapp: string;
};

const Msg = ({ s }: { s: BuyerState }) =>
  s.error ? <p role="alert" className="text-sm font-semibold text-red-600">{s.error}</p> : s.ok ? <p role="status" className="text-sm font-semibold text-emerald-700">{s.ok}</p> : null;
const btn = "w-full rounded-lg py-3 text-center font-bold";

/** Lo que el comprador puede resolver solo (como Rapiboy): fecha, indicaciones, foto de entrega y reportes. */
export function BuyerPanel({ token, verified, open, delivered, hasPhone, dates, problems, code, whatsapp }: Props) {
  const [mode, setMode] = useState<"fecha" | "notas" | "problema" | null>(null);
  const [v, verify, verifying] = useActionState(verifyAction.bind(null, token), {});
  const [r, reschedule, rescheduling] = useActionState(rescheduleAction.bind(null, token), {});
  const [n, note, noting] = useActionState(noteAction.bind(null, token), {});
  const [p, problem, reporting] = useActionState(problemAction.bind(null, token), {});
  const wa = `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, tengo una duda con mi envío ${code}`)}`;

  if (!open && !delivered) {
    return <a href={wa} target="_blank" rel="noreferrer" className={`${btn} block bg-accent text-brand`}>Escribir por WhatsApp</a>;
  }

  return (
    <div className="space-y-3">
      {delivered && verified && (
        <section className="overflow-hidden rounded-2xl bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- foto privada de la entrega */}
          <img src={`/s/${token}/evidencia`} alt="Foto de la entrega" className="max-h-96 w-full bg-slate-100 object-contain" onError={(e) => ((e.currentTarget.parentElement!.style.display = "none"))} />
          <p className="px-4 py-2 text-xs text-slate-500">Foto de la entrega con fecha, hora y ubicación.</p>
        </section>
      )}

      <section className="space-y-3 rounded-2xl bg-white p-4">
        <div>
          <h2 className="text-xl">{delivered ? "¿Algo no está bien?" : "¿No vas a estar?"}</h2>
          <p className="text-sm text-slate-600">
            {delivered ? "Si no recibiste tu paquete o llegó dañado, avísanos y lo revisamos con la tienda." : "Cambia la fecha o deja indicaciones para el repartidor."}
          </p>
        </div>

        {!verified ? (
          hasPhone ? (
            <form action={verify} className="space-y-2">
              <label className="block text-sm font-semibold">
                Para confirmar que eres tú, escribe los últimos 4 dígitos de tu teléfono
                <input name="last4" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" className="mt-1 w-full rounded-lg border-[1.5px] border-slate-200 px-3 py-2.5 text-center text-xl tracking-[0.5em]" />
              </label>
              <button disabled={verifying} className={`${btn} bg-brand text-white disabled:opacity-50`}>{verifying ? "Revisando…" : "Continuar"}</button>
              <Msg s={v} />
            </form>
          ) : (
            <p className="text-sm text-slate-600">Escríbenos por WhatsApp y lo resolvemos.</p>
          )
        ) : delivered ? (
          <form action={problem} className="space-y-2">
            <select name="kind" required defaultValue="" className="w-full rounded-lg border-[1.5px] border-slate-200 px-3 py-2.5">
              <option value="" disabled>¿Qué pasó?</option>
              {problems.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <textarea name="text" required minLength={10} rows={3} placeholder="Cuéntanos qué pasó" className="w-full rounded-lg border-[1.5px] border-slate-200 px-3 py-2" />
            <button disabled={reporting} className={`${btn} bg-brand text-white disabled:opacity-50`}>{reporting ? "Enviando…" : "Reportar un problema"}</button>
            <Msg s={p} />
          </form>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode(mode === "fecha" ? null : "fecha")} className={`${btn} ${mode === "fecha" ? "bg-brand text-white" : "border-[1.5px] border-brand"}`}>Cambiar fecha</button>
              <button type="button" onClick={() => setMode(mode === "notas" ? null : "notas")} className={`${btn} ${mode === "notas" ? "bg-brand text-white" : "border-[1.5px] border-brand"}`}>Dejar indicaciones</button>
            </div>
            {mode === "fecha" && (
              <form action={reschedule} className="space-y-2">
                <div className="grid gap-2">
                  {dates.map((d) => (
                    <label key={d.ymd} className="flex items-center gap-3 rounded-lg border-[1.5px] border-slate-200 px-3 py-2.5 has-checked:border-brand has-checked:bg-amber-50">
                      <input type="radio" name="ymd" value={d.ymd} required className="accent-brand" />
                      <span className="first-letter:uppercase">{d.label}</span>
                    </label>
                  ))}
                </div>
                <button disabled={rescheduling} className={`${btn} bg-accent text-brand disabled:opacity-50`}>{rescheduling ? "Guardando…" : "Guardar fecha"}</button>
                <Msg s={r} />
              </form>
            )}
            {mode === "notas" && (
              <form action={note} className="space-y-2">
                <input name="receiver" maxLength={80} placeholder="¿Quién más puede recibir? (opcional)" className="w-full rounded-lg border-[1.5px] border-slate-200 px-3 py-2.5" />
                <textarea name="text" maxLength={300} rows={3} placeholder="Ej. Dejar en recepción, tocar el timbre del 3, portón negro…" className="w-full rounded-lg border-[1.5px] border-slate-200 px-3 py-2" />
                <button disabled={noting} className={`${btn} bg-accent text-brand disabled:opacity-50`}>{noting ? "Guardando…" : "Guardar indicaciones"}</button>
                <Msg s={n} />
              </form>
            )}
          </>
        )}
      </section>

      <a href={wa} target="_blank" rel="noreferrer" className={`${btn} block bg-accent text-brand`}>Escribir por WhatsApp</a>
    </div>
  );
}
