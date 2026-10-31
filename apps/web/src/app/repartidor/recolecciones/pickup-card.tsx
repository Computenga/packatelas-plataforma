"use client";

import { useRef, useState, useTransition } from "react";
import { compressPhoto, currentPosition } from "@/lib/offline-queue";
import { completePickupAction, goToPickupAction } from "./actions";

type Props = {
  pickupId: string;
  mapsUrl: string;
  phone: string | null;
  enRoute: boolean;
};

const btn = "rounded-lg border border-slate-300 py-2 text-center text-sm";

export function PickupActions({ pickupId, mapsUrl, phone, enRoute }: Props) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [photos, setPhotos] = useState<{ key: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [failMode, setFailMode] = useState(false);
  const count = useRef<HTMLInputElement>(null);
  const note = useRef<HTMLInputElement>(null);

  // Navegar = ya va para allá: se avisa a la tienda con el enlace en vivo.
  const go = () => {
    if (!enRoute) start(async () => void (await goToPickupAction(pickupId)));
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setMsg({});
    try {
      for (const f of Array.from(files).slice(0, 6 - photos.length)) {
        const blob = await compressPhoto(f);
        const fd = new FormData();
        fd.append("photo", blob, "recoleccion.jpg");
        const res = await fetch("/api/driver/photo", { method: "POST", body: fd });
        const j = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
        if (!res.ok || !j.key) throw new Error(j.error ?? "No se pudo subir la foto");
        setPhotos((p) => [...p, { key: j.key!, url: URL.createObjectURL(blob) }]);
      }
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : "No se pudo subir la foto (revisa tu conexión)" });
    } finally {
      setUploading(false);
    }
  };

  const submit = (failed: boolean) =>
    start(async () => {
      const pos = await currentPosition(4000);
      const r = await completePickupAction(pickupId, {
        failed,
        count: Number(count.current?.value),
        note: note.current?.value,
        photoKeys: photos.map((p) => p.key),
        lat: pos?.coords.latitude,
        lng: pos?.coords.longitude,
      });
      setMsg(r);
    });

  if (msg.ok) return <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg.ok}</p>;

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <a href={mapsUrl} target="_blank" rel="noreferrer" onClick={go} className={`${btn} ${enRoute ? "" : "border-brand bg-brand font-medium text-white"}`}>
          {enRoute ? "Abrir mapa" : "Ir ahora"}
        </a>
        {phone ? <a className={btn} href={`tel:${phone}`}>Llamar</a> : <span className={`${btn} border-slate-200 text-slate-400`}>Sin teléfono</span>}
      </div>
      {!enRoute && <p className="text-xs text-slate-500">Al tocar «Ir ahora» la tienda recibe por WhatsApp el enlace para seguirte en vivo.</p>}

      {!failMode ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <label className="block text-sm">
            ¿Cuántos paquetes recogiste?
            <input ref={count} type="number" min={1} inputMode="numeric" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <div>
            <p className="text-sm">Fotos de lo que recolectas (obligatorio)</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.key} src={p.url} alt="Foto de la recolección" className="h-16 w-16 rounded-lg object-cover" />
              ))}
              {photos.length < 6 && (
                <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-2xl text-slate-400">
                  {uploading ? "…" : "+"}
                  <input type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={uploading} onChange={(e) => void addPhotos(e.target.files)} />
                </label>
              )}
            </div>
          </div>
          <label className="block text-sm">
            Nota
            <input ref={note} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <button type="button" disabled={pending || uploading} onClick={() => submit(false)} className="w-full rounded-lg bg-brand py-2.5 font-medium text-white disabled:opacity-60">
            {pending ? "Guardando…" : "Confirmar recolección"}
          </button>
          <button type="button" onClick={() => setFailMode(true)} className="w-full text-sm text-red-600">No se pudo recolectar</button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg bg-red-50 p-3">
          <label className="block text-sm">
            Motivo
            <input ref={note} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <button type="button" disabled={pending} onClick={() => submit(true)} className="w-full rounded-lg bg-red-600 py-2.5 font-medium text-white disabled:opacity-60">
            {pending ? "Guardando…" : "Reportar"}
          </button>
          <button type="button" onClick={() => setFailMode(false)} className="w-full text-sm text-slate-600">Volver</button>
        </div>
      )}
      {msg.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg.error}</p>}
    </div>
  );
}
