"use client";

import { useState } from "react";

/** Copia un enlace absoluto (o lo comparte en el teléfono) [C12]. */
export function CopyLink({ path, label = "Copiar enlace", text }: { path: string; label?: string; text?: string }) {
  const [done, setDone] = useState(false);
  const go = async () => {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) await navigator.share({ title: "Seguimiento de tu envío", text, url });
      else await navigator.clipboard.writeText(text ? `${text} ${url}` : url);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch {
      /* el usuario canceló */
    }
  };
  return (
    <button type="button" onClick={go} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">
      {done ? "¡Copiado!" : label}
    </button>
  );
}
