"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import type { GateScan } from "@packatelas/db";
import { Scanner } from "@/components/scanner";
import { beepOk, buzz } from "@/lib/beep";
import { checkPackageAction, departureAction } from "../../actions";

/** Salida: un paquete al azar. Si es suyo, buena fe; si no, auditoría uno por uno. */
export function Departure({ driverId, via, count }: { driverId: string; via: string; count: number }) {
  const router = useRouter();
  const [pick, setPick] = useState<GateScan | null>(null);
  const [audit, setAudit] = useState<GateScan[]>([]);
  const [busy, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<{ extra: number; missing: number } | null>(null);

  const back = useCallback(() => {
    router.push("/recepcion?modo=salida");
    router.refresh();
  }, [router]);

  // Paquete suyo: se guarda solo y regresa a la lista.
  useEffect(() => {
    if (!pick?.assigned) return;
    const id = setTimeout(back, 2500);
    return () => clearTimeout(id);
  }, [pick, back]);

  const onScan = useCallback(
    (raw: string) =>
      start(async () => {
        setErr(undefined);
        if (!pick) {
          const s = await checkPackageAction(driverId, raw, "SALIDA").catch(() => null);
          if (!s) return setErr("Sin conexión: vuelve a escanear");
          setPick(s);
          if (s.assigned) {
            beepOk();
            await departureAction({ driverId, random: raw, via }).catch(() => setErr("No se guardó; revisa la conexión"));
          } else buzz();
          return;
        }
        const s = await checkPackageAction(driverId, raw, "SALIDA").catch(() => null);
        if (!s) return setErr("Sin conexión: vuelve a escanear");
        setAudit((prev) => {
          if (prev.some((x) => (s.orderId ? x.orderId === s.orderId : x.code === s.code)) || (pick.orderId && s.orderId === pick.orderId)) return prev;
          if (s.assigned) beepOk();
          else buzz();
          return [s, ...prev];
        });
      }),
    [driverId, pick, via],
  );

  const finish = async () => {
    if (!pick) return;
    setSaving(true);
    const r = await departureAction({ driverId, random: pick.raw, audit: audit.map((a) => a.raw), via }).catch(() => null);
    setSaving(false);
    if (!r) return setErr("No se guardó; revisa la conexión");
    setDone({ extra: r.extra, missing: r.missing });
  };

  const ownAudited = audit.filter((a) => a.assigned).length;
  const extra = audit.filter((a) => !a.assigned);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-xl bg-white p-4">
          <p className="text-sm text-slate-500">Lleva en su app</p>
          <p className="text-6xl font-black">{count} paquete{count === 1 ? "" : "s"}</p>
        </div>
        {!done && (
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-4">
            <p className="mb-2 text-lg font-semibold">{!pick ? "Toma UN paquete al azar de su caja y escanéalo" : pick.assigned ? "Listo" : "Auditoría: escanea TODOS los paquetes que lleva"}</p>
            {!(pick?.assigned) && <Scanner onScan={onScan} busy={busy} initialMode="pda" />}
          </div>
        )}
        {err && <p role="alert" className="rounded-lg bg-red-100 p-3 font-semibold text-red-700">{err}</p>}
      </div>

      <div className="space-y-4">
        {pick?.assigned && (
          <div className="rounded-xl bg-emerald-600 p-6 text-white">
            <p className="text-3xl font-black">✓ {pick.code} es suyo</p>
            <p className="mt-1 text-lg">Buena fe: puede salir.</p>
          </div>
        )}
        {pick && !pick.assigned && (
          <>
            <div className="rounded-xl bg-red-600 p-6 text-white">
              <p className="text-3xl font-black">🔊 {pick.code} NO es suyo</p>
              <p className="mt-1 text-lg">{pick.orderId ? "Ese paquete no está a su nombre." : "Ese código no existe en el sistema."} Revisa uno por uno todo lo que lleva.</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="font-semibold">Auditoría · {ownAudited + (pick.assigned ? 1 : 0)} de {count} suyos escaneados</p>
              <div className="mt-2 h-3 rounded-full bg-slate-200"><div className="h-3 rounded-full bg-emerald-500" style={{ width: `${count ? Math.min(100, (ownAudited / count) * 100) : 0}%` }} /></div>
              <p className="mt-3 text-red-700">🔊 {extra.length + 1} no asignado(s) (incluye el del azar)</p>
              <ul className="mt-2 max-h-60 divide-y divide-slate-100 overflow-auto text-sm">
                {audit.map((a) => (
                  <li key={a.orderId ?? a.code} className={`flex justify-between py-1.5 ${a.assigned ? "" : "font-semibold text-red-700"}`}>
                    <span className="font-mono">{a.assigned ? "✅" : "🔊"} {a.code}</span>
                    <span>{a.assigned ? "Suyo" : a.orderId ? "No es suyo" : "No existe"}</span>
                  </li>
                ))}
              </ul>
              {!done ? (
                <button type="button" disabled={saving} onClick={finish} className="mt-4 w-full rounded-xl bg-[#14213d] py-4 text-lg font-bold text-white disabled:opacity-40">
                  {saving ? "Guardando…" : "Terminar auditoría y avisar a despacho"}
                </button>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="rounded-lg bg-slate-100 p-3 font-semibold">Guardado y avisado a despacho: {done.extra} no asignado(s), {done.missing} faltante(s).</p>
                  <button type="button" onClick={back} className="w-full rounded-xl border border-slate-300 py-3 font-semibold">Volver a la lista</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
