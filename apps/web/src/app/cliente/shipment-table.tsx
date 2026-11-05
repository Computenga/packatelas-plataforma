"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui";

export type ShipmentRow = {
  id: string; code: string; sale: string; own: boolean; recipient: string; where: string; status: string;
  tone: "gray" | "blue" | "green" | "amber" | "red"; attempts: number; lastText: string; lastAt: string; driver: string | null; tracking: string;
};

/** Envíos con acciones por renglón y en lote (como el panel de 99minutos): etiquetas, links de rastreo, exportar. */
export function ShipmentTable({ rows }: { rows: ShipmentRow[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string>();
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const picked = rows.filter((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(undefined), 2500);
    } catch {
      window.prompt("Copia el texto:", text);
    }
  };
  const ownPicked = picked.filter((r) => r.own);

  return (
    <div className="space-y-2">
      {picked.length > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white md:top-2">
          <span className="mr-1">{picked.length} seleccionado(s)</span>
          {ownPicked.length > 0 && (
            <a href={`/etiqueta/varias?ids=${ownPicked.map((r) => r.id).join(",")}`} target="_blank" rel="noreferrer" className="rounded-lg bg-accent px-3 py-1.5 font-bold text-brand">
              Imprimir {ownPicked.length} etiqueta(s)
            </a>
          )}
          <button type="button" onClick={() => copy(picked.map((r) => `${r.recipient} (${r.code}): ${r.tracking}`).join("\n"), "lote")} className="rounded-lg border border-white/50 px-3 py-1.5">
            {copied === "lote" ? "Links copiados" : "Copiar links de rastreo"}
          </button>
          <a href={`/cliente/exportar?ids=${picked.map((r) => r.id).join(",")}`} className="rounded-lg border border-white/50 px-3 py-1.5">Exportar</a>
          <button type="button" onClick={() => setSel(new Set())} className="ml-auto text-slate-300">Quitar selección</button>
        </div>
      )}

      {/* Computadora: tabla */}
      <div className="hidden overflow-hidden rounded-xl bg-white md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-[13px] text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Seleccionar todos" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} className="h-4 w-4 accent-brand" /></th>
              <th className="px-3 font-semibold">Folio</th>
              <th className="px-3 font-semibold">Destinatario</th>
              <th className="px-3 font-semibold">Estado</th>
              <th className="px-3 font-semibold">Último movimiento</th>
              <th className="px-3 font-semibold">Repartidor</th>
              <th className="px-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-slate-100 last:border-0 ${sel.has(r.id) ? "bg-amber-50/60" : ""}`}>
                <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Seleccionar ${r.code}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-brand" /></td>
                <td className="px-3"><Link href={`/cliente/envio/${r.id}`} className="font-bold tabular-nums hover:underline">{r.code}</Link><span className="block text-xs text-slate-500">{r.sale}</span></td>
                <td className="px-3">{r.recipient}<span className="block text-xs text-slate-500">{r.where}</span></td>
                <td className="px-3"><Badge tone={r.tone}>{r.attempts > 0 && r.status !== "Entregado" ? `${r.status} · intento ${r.attempts}` : r.status}</Badge></td>
                <td className="max-w-64 px-3"><span className="line-clamp-1">{r.lastText}</span><span className="block text-xs text-slate-500">{r.lastAt}</span></td>
                <td className="px-3 text-slate-600">{r.driver ?? "—"}</td>
                <td className="px-3 text-right text-[13px] font-semibold whitespace-nowrap text-slate-500">
                  <button type="button" onClick={() => copy(r.tracking, r.id)} className="hover:text-brand">{copied === r.id ? "Copiado" : "Rastreo"}</button>
                  <span className="mx-2 text-slate-300">|</span>
                  <Link href={`/cliente/soporte?envio=${encodeURIComponent(r.code)}`} className="hover:text-brand">Reportar</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No hay envíos en esta pestaña.</p>}
      </div>

      {/* Celular: tarjetas */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className={`flex gap-3 rounded-xl bg-white p-3 ${r.tone === "red" || r.tone === "amber" ? "border-l-[6px] border-red-500" : ""}`}>
            <input type="checkbox" aria-label={`Seleccionar ${r.code}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="mt-1 h-5 w-5 shrink-0 accent-brand" />
            <div className="min-w-0 flex-1">
              <Link href={`/cliente/envio/${r.id}`} className="block">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-display text-xl leading-tight font-extrabold">{r.recipient}</span>
                  <Badge tone={r.tone}>{r.status}</Badge>
                </span>
                <span className="block truncate text-sm text-slate-600">{r.where}</span>
                <span className="block text-xs text-slate-500"><b className="text-slate-700 tabular-nums">{r.code}</b> · {r.lastText} · {r.lastAt}</span>
              </Link>
              <span className="mt-2 flex gap-4 text-sm font-semibold text-brand">
                <button type="button" onClick={() => copy(r.tracking, r.id)}>{copied === r.id ? "Copiado" : "Copiar rastreo"}</button>
                <Link href={`/cliente/soporte?envio=${encodeURIComponent(r.code)}`}>Reportar</Link>
              </span>
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="rounded-xl bg-white p-6 text-center text-sm text-slate-500">No hay envíos en esta pestaña.</li>}
      </ul>
    </div>
  );
}
