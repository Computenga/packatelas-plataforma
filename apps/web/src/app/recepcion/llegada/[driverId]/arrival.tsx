"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import type { GatePkg, GateScan } from "@packatelas/db";
import { Scanner } from "@/components/scanner";
import { SignaturePad, type SignatureHandle } from "@/components/signature-pad";
import { beepOk, buzz } from "@/lib/beep";
import { arrivalAction, checkPackageAction } from "../../actions";

/** Llegada: se escanea todo lo que trae; el sistema suma y compara contra su inventario. */
export function Arrival({ driverId, via, expected }: { driverId: string; via: string; expected: GatePkg[] }) {
  const router = useRouter();
  const [scans, setScans] = useState<GateScan[]>([]);
  const [busy, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>();
  const [signed, setSigned] = useState(false);
  const sig = useRef<SignatureHandle>(null);

  const onScan = useCallback(
    (raw: string) =>
      start(async () => {
        const s = await checkPackageAction(driverId, raw, "LLEGADA").catch(() => null);
        if (!s) return setErr("Sin conexión: vuelve a escanear");
        setErr(undefined);
        setScans((prev) => {
          if (prev.some((x) => (s.orderId ? x.orderId === s.orderId : x.code === s.code))) return prev;
          if (s.assigned) beepOk();
          else buzz();
          return [s, ...prev];
        });
      }),
    [driverId],
  );

  const seen = new Set(scans.map((s) => s.orderId).filter(Boolean));
  const extra = scans.filter((s) => !s.assigned);
  const missing = expected.filter((e) => !seen.has(e.orderId));
  const ok = extra.length === 0 && missing.length === 0;

  const save = async () => {
    const signature = sig.current?.toDataUrl();
    if (!signature) return setErr("Falta la firma del repartidor");
    setSaving(true);
    const r = await arrivalAction({ driverId, raws: scans.map((s) => s.raw), signature, via }).catch(() => ({ error: "Sin conexión; inténtalo de nuevo" }));
    setSaving(false);
    if ("error" in r) return setErr(r.error);
    router.push("/recepcion?modo=llegada");
    router.refresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <div className="rounded-xl bg-white p-4">
          <p className="mb-2 font-semibold">Escanea cada paquete que trae (QR de Mercado Libre o etiqueta externa)</p>
          <Scanner onScan={onScan} busy={busy} initialMode="pda" />
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border-l-4 border-slate-800 bg-white p-3"><p className="text-xs uppercase text-slate-500">Debe traer</p><p className="text-4xl font-black">{expected.length}</p></div>
          <div className="rounded-xl border-l-4 border-emerald-500 bg-white p-3"><p className="text-xs uppercase text-slate-500">Escaneados</p><p className="text-4xl font-black">{scans.length}</p></div>
          <div className="rounded-xl border-l-4 border-red-500 bg-white p-3"><p className="text-xs uppercase text-slate-500">Diferencias</p><p className={`text-4xl font-black ${ok ? "" : "text-red-600"}`}>{extra.length + missing.length}</p></div>
        </div>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white">
          {extra.map((s) => (
            <li key={`x-${s.code}`} className="flex justify-between bg-red-50 p-3 text-red-700"><span className="font-mono font-bold">🔊 {s.code}</span><span className="font-semibold">{s.orderId ? "No está a su nombre" : "No existe en el sistema"} → revisión manual</span></li>
          ))}
          {scans.filter((s) => s.assigned).map((s) => (
            <li key={s.orderId} className="flex justify-between p-3"><span className="font-mono">✅ {s.code}</span><span className="text-slate-500">Suyo</span></li>
          ))}
          {missing.map((m) => (
            <li key={`m-${m.orderId}`} className="flex justify-between bg-amber-50 p-3 text-amber-800"><span className="font-mono">⏳ {m.code}</span><span className="font-semibold">A su nombre, no escaneado</span></li>
          ))}
          {expected.length === 0 && scans.length === 0 && <li className="p-4 text-center text-slate-500">No tiene paquetes a su nombre. Si trae alguno, escanéalo.</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <div className={`rounded-xl p-4 text-white ${ok ? "bg-emerald-600" : "bg-red-600"}`}>
          <p className="text-2xl font-black">{ok ? "✓ Cuadra" : "🔊 No cuadra"}</p>
          <p>{ok ? "Trae justo lo que tiene a su nombre." : `${extra.length} que no son suyos · ${missing.length} que le faltan. Al guardar se avisa a despacho para revisión manual.`}</p>
        </div>
        <div className="rounded-xl bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">Firma del repartidor</p>
            <button type="button" onClick={() => sig.current?.clear()} className="text-sm text-slate-500">Borrar</button>
          </div>
          <SignaturePad ref={sig} onChange={(empty) => setSigned(!empty)} className="h-56" />
          <p className="mt-2 text-xs text-slate-500">Firmo de conformidad con los paquetes escaneados.</p>
        </div>
        {err && <p role="alert" className="rounded-lg bg-red-100 p-3 font-semibold text-red-700">{err}</p>}
        <button type="button" disabled={saving || !signed} onClick={save} className="rounded-xl bg-[#14213d] py-5 text-xl font-bold text-white disabled:opacity-40">
          {saving ? "Guardando…" : "Firmar y dar acceso"}
        </button>
      </div>
    </div>
  );
}
