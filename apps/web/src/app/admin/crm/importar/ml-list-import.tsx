"use client";

import { useState, useTransition } from "react";
import readXlsxFile from "read-excel-file";
import type { MlSellerImportSummary, MlSellerRow } from "@packatelas/db";
import { importMlListAction } from "./actions";

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Columnas del listado de ML (Seller ID, CUS_NICKNAME, CUS_PHONE1…) o equivalentes en español. */
function toRows(table: unknown[][]): { rows: MlSellerRow[]; mapped: string[]; error?: string } {
  const [head = [], ...body] = table;
  const h = head.map(norm);
  const find = (...names: string[]) => h.findIndex((x) => names.some((n) => x === n || x.endsWith(n)));
  const col = {
    sellerId: find("sellerid", "idvendedor", "vendedor"),
    nickname: find("cusnickname", "nickname", "seudonimo", "apodo"),
    phone1: find("cusphone1", "phone1", "telefono", "telefono1"),
    phone2: find("cusphone2", "phone2", "telefono2"),
    email: find("cusemail", "email", "correo"),
    city: find("cuscity", "city", "ciudad", "municipio", "alcaldia"),
    state: find("cusstate", "state", "estado"),
    address: find("cusaddress", "address", "direccion"),
  };
  if (col.nickname < 0 && col.sellerId < 0) return { rows: [], mapped: [], error: "No encontré la columna del seudónimo (CUS_NICKNAME) ni la del vendedor (Seller ID)" };
  const v = (r: unknown[], i: number) => (i >= 0 && r[i] != null ? String(r[i]).trim() : "") || null;
  const rows = body
    .filter((r) => r.some((c) => c != null && String(c).trim()))
    .map((r) => ({ sellerId: v(r, col.sellerId), nickname: v(r, col.nickname), phone1: v(r, col.phone1), phone2: v(r, col.phone2), email: v(r, col.email), city: v(r, col.city), state: v(r, col.state), address: v(r, col.address) }));
  return { rows, mapped: Object.entries(col).filter(([, i]) => i >= 0).map(([k, i]) => `${k} ← ${String(head[i])}`) };
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

export function MlListImport() {
  const [rows, setRows] = useState<MlSellerRow[]>([]);
  const [mapped, setMapped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ error?: string; summary?: MlSellerImportSummary } | null>(null);
  const [pending, start] = useTransition();

  const onFile = async (f: File | undefined) => {
    setResult(null);
    setError(null);
    setRows([]);
    if (!f) return;
    try {
      const table = /\.csv$/i.test(f.name) ? parseCsv(await f.text()) : ((await readXlsxFile(f)) as unknown[][]);
      const r = toRows(table);
      if (r.error) setError(r.error);
      setRows(r.rows);
      setMapped(r.mapped);
    } catch {
      setError("No pude leer el archivo. Súbelo como .xlsx o .csv");
    }
  };

  const send = () =>
    start(async () => {
      // En tandas para no mandar un archivo enorme de una sola vez.
      const total: MlSellerImportSummary = { created: 0, withWhatsapp: 0, alreadyClients: 0, repeated: 0, skipped: 0, phoneFixed: 0, phoneBad: 0 };
      for (let i = 0; i < rows.length; i += 500) {
        const r = await importMlListAction(rows.slice(i, i + 500));
        if (r.error) { setResult({ error: r.error }); return; }
        for (const k of Object.keys(total) as (keyof MlSellerImportSummary)[]) total[k] += r.summary![k];
      }
      setResult({ summary: total });
    });

  return (
    <div className="space-y-4 text-sm">
      <input type="file" accept=".xlsx,.csv" onChange={(e) => void onFile(e.target.files?.[0])} className="block" />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {rows.length > 0 && !error && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p><strong>{rows.length}</strong> vendedores leídos. Columnas reconocidas:</p>
          <ul className="list-disc pl-5 text-xs text-slate-600">{mapped.map((m) => <li key={m}>{m}</li>)}</ul>
          <button type="button" disabled={pending} onClick={send} className="rounded-lg bg-brand px-4 py-2 font-medium text-white disabled:opacity-50">
            {pending ? "Importando…" : `Importar ${rows.length} vendedores`}
          </button>
        </div>
      )}
      {result?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{result.error}</p>}
      {result?.summary && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
          Listo: {result.summary.created} prospectos nuevos ({result.summary.withWhatsapp} con teléfono para WhatsApp), {result.summary.alreadyClients} que ya son clientes,{" "}
          {result.summary.repeated} que ya estaban en el CRM y {result.summary.skipped} sin teléfono ni correo. Teléfonos corregidos: {result.summary.phoneFixed}; no identificables: {result.summary.phoneBad}.
        </p>
      )}
    </div>
  );
}
