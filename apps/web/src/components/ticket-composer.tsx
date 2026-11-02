"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { compressPhoto } from "@/lib/offline-queue";
import { FormMessage } from "./ui";
import type { ActionState } from "./action-form";

/** Formulario de reporte o respuesta con foto opcional (se reduce antes de subirla). */
export function TicketComposer({ action, submitLabel, children, placeholder = "Escribe tu mensaje…", textName = "text", required = true }: {
  action: (fd: FormData) => Promise<ActionState>;
  submitLabel: string;
  children?: ReactNode;
  placeholder?: string;
  textName?: string;
  required?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [photoName, setPhotoName] = useState("");

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const f = fd.get("photo");
      if (f instanceof File && f.size > 0) fd.set("photo", new File([await compressPhoto(f)], "foto.jpg", { type: "image/jpeg" }));
      else fd.delete("photo");
      const r = await action(fd);
      setState(r);
      if (r.ok) {
        form.reset();
        setPhotoName("");
      }
    });
  };

  return (
    <form ref={ref} onSubmit={submit} className="space-y-3">
      {children}
      <textarea name={textName} required={required} rows={4} maxLength={4000} placeholder={placeholder} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          📎 {photoName ? "Cambiar foto" : "Agregar foto"}
          <input type="file" name="photo" accept="image/*" className="sr-only" onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? "")} />
        </label>
        {photoName && <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{photoName}</span>}
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Enviando…" : submitLabel}
        </button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
