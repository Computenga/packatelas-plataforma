"use client";

import { useState, useTransition } from "react";
import type { LeadImportSummary } from "@packatelas/db";
import { importLeadsAction } from "./actions";

type Row = { at: string | null; businessName: string | null; contactName: string | null; phone: string | null; email: string | null; zone: "cmx" | "emx" | null; salesChannels: string | null; notes: string | null };

/** CSV con comillas y saltos de línea dentro de los campos. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "27/2/2026 17:49:14" (Google Forms, hora de México) → ISO. */
function formDate(s: string) {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return Number.isNaN(Date.parse(s)) ? null : new Date(s).toISOString();
  const [, d, mo, y, h = "12", mi = "0", se = "0"] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h + 6, +mi, +se)).toISOString();
}

function toRows(table: string[][]): { rows: Row[]; mapped: string[] } {
  const [head, ...body] = table;
  const h = head.map(norm);
  const find = (...tests: ((x: string) => boolean)[]) => {
    for (const t of tests) {
      const i = h.findIndex(t);
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = {
    at: find((x) => x.includes("marca temporal"), (x) => x.includes("fecha")),
    businessName: find((x) => x.includes("nombre de tu negocio"), (x) => x.includes("negocio"), (x) => x.includes("razon social")),
    legal: find((x) => x.includes("razon social")),
    contactName: find((x) => x === "nombre", (x) => x.includes("contacto")),
    phone: find((x) => x.includes("whatsapp") && x.includes("tel"), (x) => x.includes("telefono"), (x) => x.includes("whatsapp")),
    email: find((x) => x.includes("correo"), (x) => x.includes("email")),
    state: find((x) => x.includes("ciudad") && x.includes("estado"), (x) => x.includes("estado")),
    shop: find((x) => x.includes("e-commerce") || x.includes("ecommerce"), (x) => x.includes("vende")),
    flex: find((x) => x.includes("flex")),
    street: find((x) => x === "calle"),
    colonia: find((x) => x === "colonia"),
    city: find((x) => x.includes("alcaldia")),
  };
  const v = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows = body.map((r) => {
    const state = norm(v(r, col.state));
    const zone = !state ? null : /cdmx|ciudad de mexico|^df|distrito/.test(state) ? "cmx" : /mex|edomex/.test(state) ? "emx" : "cmx";
    const addr = [v(r, col.street), v(r, col.colonia), v(r, col.city)].filter(Boolean).join(", ");
    const notes = [v(r, col.flex) && `¿Usa Flex?: ${v(r, col.flex)}`, addr && `Dirección: ${addr}`, v(r, col.legal) && `Razón social: ${v(r, col.legal)}`].filter(Boolean).join("\n");
    return {
      at: col.at >= 0 ? formDate(v(r, col.at)) : null,
      businessName: v(r, col.businessName) || v(r, col.legal) || null,
      contactName: v(r, col.contactName) || null,
      phone: v(r, col.phone) || null,
      email: v(r, col.email) || null,
      zone: zone as Row["zone"],
      salesChannels: v(r, col.shop) || null,
      notes: notes || null,
    };
  });
  const mapped = Object.entries(col).filter(([, i]) => i >= 0).map(([k, i]) => `${k} ← ${head[i]}`);
  return { rows, mapped };
}

export function LeadImport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [mapped, setMapped] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [result, setResult] = useState<{ error?: string; summary?: LeadImportSummary } | null>(null);
  const [pending, start] = useTransition();

  const onFile = async (f: File | undefined) => {
    setResult(null);
    if (!f) return;
    const r = toRows(parseCsv(await f.text()));
    setRows(r.rows);
    setMapped(r.mapped);
  };

  return (
    <div className="space-y-4 text-sm">
      <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="block" />
      {rows.length > 0 && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p><strong>{rows.length}</strong> renglones leídos. Columnas reconocidas:</p>
          <ul className="list-disc pl-5 text-xs text-slate-600">{mapped.map((m) => <li key={m}>{m}</li>)}</ul>
          <label className="flex items-center gap-2">
            Los registros de hace más de
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-20 rounded-lg border border-slate-300 px-2 py-1" />
            días entran como «Perdido» (se pueden reactivar).
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setResult(await importLeadsAction(rows, days)))}
            className="rounded-lg bg-brand px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Importando…" : `Importar ${rows.length} prospectos`}
          </button>
        </div>
      )}
      {result?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{result.error}</p>}
      {result?.summary && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
          Listo: {result.summary.created} prospectos nuevos, {result.summary.linked} ligados a clientes recientes, {result.summary.lost} viejos como «Perdido»,{" "}
          {result.summary.repeated} repetidos, {result.summary.alreadyClients} que ya eran clientes (no entran) y {result.summary.skipped} sin teléfono ni correo.
        </p>
      )}
    </div>
  );
}
