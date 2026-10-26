"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { compressPhoto } from "@/lib/offline-queue";

export type DocRow = { key: string; name: string; description: string | null; required: boolean; status: "PENDIENTE" | "APROBADO" | "RECHAZADO" | null; comment: string | null; viewUrl?: string | null };

const BADGE = {
  APROBADO: "bg-emerald-50 text-emerald-700",
  PENDIENTE: "bg-blue-50 text-blue-700",
  RECHAZADO: "bg-red-50 text-red-700",
} as const;
const LABEL = { APROBADO: "Aprobado", PENDIENTE: "En revisión", RECHAZADO: "Rechazado" } as const;

/** Lista de documentos con su estado y botón para subir/reemplazar (foto o PDF). */
export function DocUploader({ rows, endpoint, extra, locked }: { rows: DocRow[]; endpoint: string; extra?: Record<string, string>; locked?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});

  async function upload(key: string, file?: File) {
    if (!file) return;
    setBusy(key);
    setError((e) => ({ ...e, [key]: "" }));
    try {
      const body = new FormData();
      const blob = file.type.startsWith("image/") && file.size > 1_500_000 ? await compressPhoto(file) : file;
      body.append("file", blob, file.name);
      body.append("docType", key);
      for (const [k, v] of Object.entries(extra ?? {})) body.append(k, v);
      const res = await fetch(endpoint, { method: "POST", body });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "No se pudo subir");
      router.refresh();
    } catch (e) {
      setError((x) => ({ ...x, [key]: e instanceof Error ? e.message : "Error" }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => {
        const canUpload = !locked && r.status !== "APROBADO";
        return (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.name}{r.required && <span className="text-red-500"> *</span>}</p>
              {r.description && <p className="text-xs text-slate-500">{r.description}</p>}
              {r.status === "RECHAZADO" && r.comment && <p className="text-xs text-red-700">Corregir: {r.comment}</p>}
              {error[r.key] && <p role="alert" className="text-xs text-red-700">{error[r.key]}</p>}
            </div>
            <div className="flex items-center gap-2">
              {r.status ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{LABEL[r.status]}</span> : <span className="text-xs text-slate-400">Falta</span>}
              {r.viewUrl && <a href={r.viewUrl} target="_blank" rel="noreferrer" className="text-xs text-brand">Ver</a>}
              {canUpload && (
                <label className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ${r.status ? "border border-slate-300 bg-white" : "bg-brand text-white"}`}>
                  {busy === r.key ? "Subiendo…" : r.status ? "Reemplazar" : "Subir"}
                  <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={!!busy} onChange={(e) => upload(r.key, e.target.files?.[0])} />
                </label>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
