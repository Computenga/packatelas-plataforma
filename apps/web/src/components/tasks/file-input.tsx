"use client";

import { useState } from "react";

export const ACCEPT = "image/*,application/pdf,.docx,.xlsx,.pptx";

/** Selector de archivos múltiple con la lista de lo elegido. */
export function FileInput({ label = "Adjuntar archivos", name = "files" }: { label?: string; name?: string }) {
  const [names, setNames] = useState<string[]>([]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        📎 {label}
        <input type="file" name={name} multiple accept={ACCEPT} className="sr-only" onChange={(e) => setNames([...(e.target.files ?? [])].map((f) => f.name))} />
      </label>
      {names.length > 0 && <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{names.join(", ")}</span>}
    </div>
  );
}
