"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">Imprimir o guardar PDF</button>;
}
