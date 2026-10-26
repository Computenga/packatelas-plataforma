"use client";

import { useState } from "react";
import { compressPhoto } from "@/lib/offline-queue";

/**
 * Casillas de foto: cada una toma/elige una foto, la comprime en el teléfono y la sube.
 * Deja las claves en campos ocultos `name` para el formulario.
 */
export function PhotoSlots({ name, labels, max, min = 1 }: { name: string; labels?: string[]; max?: number; min?: number }) {
  const count = labels?.length ?? max ?? 4;
  const [slots, setSlots] = useState<{ key?: string; url?: string; busy?: boolean; error?: string }[]>(Array.from({ length: count }, () => ({})));
  const set = (i: number, v: (typeof slots)[number]) => setSlots((s) => s.map((x, j) => (j === i ? v : x)));

  async function pick(i: number, file?: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    set(i, { url, busy: true });
    try {
      const fd = new FormData();
      fd.append("photo", await compressPhoto(file), "foto.jpg");
      const res = await fetch("/api/fleet/photo", { method: "POST", body: fd });
      const j = (await res.json()) as { key?: string; error?: string };
      if (!res.ok || !j.key) throw new Error(j.error ?? "No se pudo subir");
      set(i, { url, key: j.key });
    } catch (e) {
      set(i, { url, error: e instanceof Error ? e.message : "Error" });
    }
  }

  const done = slots.filter((s) => s.key).length;
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {slots.map((s, i) => (
          <label key={i} className={`relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-center text-[11px] ${s.error ? "border-red-300 bg-red-50" : s.key ? "border-emerald-300" : "border-slate-300 bg-slate-50"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.url && <img src={s.url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            <span className={`relative rounded px-1 ${s.url ? "bg-white/85" : ""}`}>{s.busy ? "Subiendo…" : s.error ? "Reintentar" : s.key ? "✓" : labels?.[i] ?? `Foto ${i + 1}`}</span>
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(i, e.target.files?.[0])} />
            {s.key && <input type="hidden" name={name} value={s.key} />}
          </label>
        ))}
      </div>
      <p className={`mt-1 text-xs ${done < min ? "text-slate-500" : "text-emerald-700"}`}>{done} de {count} foto(s){min && min < count ? ` (mínimo ${min})` : ""}</p>
    </div>
  );
}
