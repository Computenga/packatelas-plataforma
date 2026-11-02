"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compressPhoto } from "@/lib/offline-queue";

/** Toma o elige la foto de perfil; se reduce en el teléfono antes de subirla. */
export function PhotoForm({ src, name }: { src: string | null; name: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setMsg({});
    try {
      const blob = await compressPhoto(f);
      setPreview(URL.createObjectURL(blob));
      const fd = new FormData();
      fd.append("photo", blob, "perfil.jpg");
      const res = await fetch("/api/driver/profile-photo", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "No se pudo subir");
      setMsg({ ok: "Foto guardada" });
      router.refresh();
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : "No se pudo subir. Revisa tu señal." });
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? src;
  return (
    <div className="flex items-center gap-4">
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown} alt="Tu foto" className="h-24 w-24 rounded-full border border-slate-200 object-cover" />
      ) : (
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-brand/10 text-2xl font-bold text-brand">{initials}</span>
      )}
      <div className="space-y-2 text-sm">
        <input ref={input} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-lg bg-brand px-4 py-2 font-medium text-white disabled:opacity-50">
          {busy ? "Subiendo…" : shown ? "Cambiar foto" : "Tomar foto"}
        </button>
        <p className="text-xs text-slate-500">De frente, con buena luz y sin lentes oscuros.</p>
        {msg.ok && <p className="text-emerald-700">{msg.ok}</p>}
        {msg.error && <p className="text-red-700">{msg.error}</p>}
      </div>
    </div>
  );
}
